#!/usr/bin/env bash
# Backup/restore drill (docs/runbooks/backup-restore.md). Proves that a backup can be turned back
# into a working database, and measures how long that takes (the restore part of RTO).
#
#   SOURCE_URL=postgresql://…/commercecore  TARGET_URL=postgresql://…/commercecore_restore_drill \
#     deploy/backup/restore-drill.sh
#
# 1. pg_dump the source (custom format, compressed, consistent snapshot).
# 2. Drop and recreate the TARGET database and pg_restore into it. The target's name must contain
#    "restore" or "drill": this step destroys whatever is there.
# 3. Verify: same migrations applied, same row count in every table, same checksum over the
#    money and stock columns that matter most, and constraints still present.
# Prints timings; exits non-zero on any difference. Never touches the source beyond reading it.
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is required}"
: "${TARGET_URL:?TARGET_URL is required}"

target_db=$(node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" "$TARGET_URL")
if [[ ! "$target_db" =~ (restore|drill) ]]; then
  echo "Refusing: the target database \"$target_db\" must have \"restore\" or \"drill\" in its name." >&2
  exit 2
fi
source_db=$(node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" "$SOURCE_URL")
if [[ "$source_db" == "$target_db" ]]; then
  echo "Refusing: source and target are the same database." >&2
  exit 2
fi

# libpq ignores Prisma's ?schema= parameter; strip query strings.
strip() { echo "${1%%\?*}"; }
SRC=$(strip "$SOURCE_URL")
DST=$(strip "$TARGET_URL")
ADMIN=$(node -e "const u=new URL(process.argv[1]);u.pathname='/postgres';console.log(u.toString())" "$DST")

workdir=$(mktemp -d)
dump="$workdir/commercecore.dump"
trap 'rm -rf "$workdir"' EXIT

now() { date +%s.%N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }

echo "Drill: $source_db → $target_db"

t0=$(now)
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$dump" "$SRC"
t1=$(now)
size=$(du -h "$dump" | cut -f1)
echo "  backup   $(elapsed "$t0" "$t1") s  ($size)"

psql "$ADMIN" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$target_db\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$target_db\""
pg_restore --no-owner --no-privileges --exit-on-error --jobs=4 --dbname="$DST" "$dump"
# pg_restore does not carry planner statistics. Without them the first hours of traffic run on
# bad plans: the staging rehearsal's catalog listing served half its throughput until this ran.
vacuumdb --analyze-only --quiet --dbname="$DST"
t2=$(now)
echo "  restore  $(elapsed "$t1" "$t2") s  (including ANALYZE)"

# ── Verification ──────────────────────────────────────────────────────────────────────────────
fingerprint() {
  psql "$1" -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'migrations=' || string_agg(migration_name, ',' ORDER BY migration_name)
  FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT 'constraints=' || count(*) FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public';
SELECT 'indexes=' || count(*) FROM pg_indexes WHERE schemaname = 'public';
SELECT 'orders=' || count(*) || ':' || coalesce(sum(total_minor), 0) FROM orders;
SELECT 'payments=' || count(*) || ':' || coalesce(sum(amount_minor), 0) FROM payments;
SELECT 'refunds=' || count(*) || ':' || coalesce(sum(amount_minor), 0) FROM refunds;
SELECT 'stock=' || count(*) || ':' || coalesce(sum(stock_quantity), 0) FROM product_variants;
SELECT 'movements=' || count(*) || ':' || coalesce(sum(delta), 0) FROM inventory_movements;
SELECT 'users=' || count(*) FROM users;
SELECT 'outbox=' || count(*) FROM outbox_events;
SELECT 'audit=' || count(*) FROM audit_logs;
SQL
}

table_counts() {
  psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "
    SELECT string_agg(format('%s=%s', relname, n_live), ',' ORDER BY relname) FROM (
      SELECT c.relname, (xpath('/row/n/text()',
        query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text AS n_live
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r') t"
}

src_fp=$(fingerprint "$SRC"); dst_fp=$(fingerprint "$DST")
src_counts=$(table_counts "$SRC"); dst_counts=$(table_counts "$DST")
t3=$(now)
echo "  verify   $(elapsed "$t2" "$t3") s"

status=0
if [[ "$src_fp" != "$dst_fp" ]]; then
  echo "MISMATCH in fingerprint:" >&2
  diff <(echo "$src_fp" | tr ',' '\n') <(echo "$dst_fp" | tr ',' '\n') >&2 || true
  status=1
fi
if [[ "$src_counts" != "$dst_counts" ]]; then
  echo "MISMATCH in table row counts:" >&2
  diff <(echo "$src_counts" | tr ',' '\n') <(echo "$dst_counts" | tr ',' '\n') >&2 || true
  status=1
fi

echo "$dst_fp" | grep -v '^migrations=' | sed 's/^/  /'
echo "  tables   $(echo "$dst_counts" | tr ',' '\n' | wc -l) (row counts identical: $([[ "$src_counts" == "$dst_counts" ]] && echo yes || echo NO))"
echo "  total    $(elapsed "$t0" "$t3") s"

if [[ $status -eq 0 ]]; then
  echo "PASS: the restored database matches the source."
else
  echo "FAIL: the restored database differs from the source." >&2
fi
exit $status
