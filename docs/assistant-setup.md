# Shopping Assistant — Setup and Operation

How to run the M13 shopping assistant locally, give it real providers, keep its index fresh and
check it. The design is in [ADR 0025](decisions/0025-shopping-assistant-rag-groq-openai.md) and
[assistant-rag-plan.md](assistant-rag-plan.md).

## 1. pgvector

The migration `20261114200000_assistant` runs `CREATE EXTENSION vector`, so the PostgreSQL server
needs the pgvector files first.

- **CI and staging** use the `pgvector/pgvector:0.8.6-pg17` image (`.github/workflows/ci.yml`,
  `deploy/staging/compose.yaml`). Nothing to do.
- **Local Windows PostgreSQL 18:** build pgvector once with the Visual Studio 2022 C++ build
  tools, then install it as administrator:

  ```bat
  call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  set "PGROOT=C:\Program Files\PostgreSQL\18"
  git clone --branch v0.8.6 --depth 1 https://github.com/pgvector/pgvector.git
  cd pgvector
  nmake /F Makefile.win
  rem In a prompt opened with "Run as administrator", with the same two `set`/`call` lines:
  nmake /F Makefile.win install
  ```

  Check it is available with
  `SELECT default_version FROM pg_available_extensions WHERE name = 'vector';`.
- **macOS/Linux:** `brew install pgvector`, or your distribution's `postgresql-<version>-pgvector`
  package.

Then apply migrations to the development and test databases (`npx prisma migrate deploy`, once
with `DATABASE_URL` and once with it pointed at `DATABASE_URL_TEST`).

## 2. Try it without accounts

```bash
cd backend
npm run assistant:fake-llm
```

It starts stand-ins for Groq and OpenAI on ports 4110 and 4111 and prints the lines to add to
`backend/.env`. Restart the API, run `npm run assistant:index`, and the "Ask us" button appears on
the storefront. The stand-ins follow a fixed policy: they call one fitting tool and list what it
returned. They are for checking the plumbing, not answer quality.

## 3. Real providers

Put these in `backend/.env` only. Never commit them.

| Variable | What |
|---|---|
| `GROQ_API_KEY` | From console.groq.com. Optional: without it, OpenAI answers everything |
| `GROQ_CHAT_MODEL` | A Groq model that supports tool use, e.g. `openai/gpt-oss-120b` (check console.groq.com/docs/models) |
| `OPENAI_API_KEY` | From platform.openai.com. Optional: without it the assistant runs on Groq alone (§3a) |
| `OPENAI_CHAT_MODEL` | The fallback chat model, required with the key |
| `OPENAI_EMBEDDING_MODEL` | Default `text-embedding-3-small`. The columns are `vector(1536)`, so another size needs a migration |
| `ASSISTANT_DAILY_TOKEN_BUDGET` | Tokens per signed-in customer per UTC day (default 60,000) |
| `ASSISTANT_GUEST_DAILY_MESSAGES` | Messages per guest IP per UTC day (default 20) |
| `ASSISTANT_INDEX_INTERVAL_MS` | How often the worker refreshes the index (default 15 minutes) |

Remove the `*_BASE_URL` lines the stand-in printed, so the defaults (the real APIs) apply. Then run
`npm run assistant:index` once. The first run embeds every public product and every knowledge file;
later runs embed only what changed.

### 3a. Groq alone

With only `GROQ_API_KEY` and `GROQ_CHAT_MODEL` set, the assistant runs on Groq alone
([ADR 0025 amendment](decisions/0025-shopping-assistant-rag-groq-openai.md#amendment-2026-11-23-groq-alone)):

- Policy questions are answered from PostgreSQL full-text search over the knowledge files. Run
  `npm run assistant:index` once so the files are in the database; it makes no API calls in this
  mode and prints `Products: skipped`.
- Products are found by the catalog's keyword and filter search. There is no search by meaning.
- There is no fallback: when Groq fails or rate-limits, the customer sees "not available right now"
  and can retry.
- Groq's free tier allows 8,000 tokens a minute per model; one answer uses roughly 2,500–6,000, so
  expect about two answers a minute across the whole store. A paid Groq plan raises this.

Adding `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` later switches back to embeddings and fallback with
no code change; run `npm run assistant:index` to embed everything.

## 4. Keeping it current

- **Products:** the worker's recurring `ASSISTANT_INDEX_SWEEP` job re-embeds changed products and
  removes products that are no longer public. It runs every `ASSISTANT_INDEX_INTERVAL_MS`. After a
  big catalog import, run `npm run assistant:index` to catch up at once. Prices and stock are
  never in the index; they are read live, so a stale index only affects which products are found.
- **Policy text:** edit `backend/content/assistant/*.md` (format in its README). Set
  `status: confirmed` only once PRD §9 has decided that policy. Then run `npm run assistant:index`.
  Keep the text in step with `/shipping`, `/faq` and `faqs.ts`.
- **Retention:** the recurring `ASSISTANT_RETENTION` job deletes conversations 30 days after their
  last message.
- Both jobs appear at `/admin/jobs`.

## 5. Watching it

- `/admin/assistant` lists conversations, with failed replies and token use. Opening one shows the
  text and is audited (`assistant.conversation.viewed`).
- The API logs `Assistant provider failed` with the provider, the failure kind and the HTTP status,
  never message text or keys. A run of these from Groq with OpenAI answering means the fallback is
  carrying the load.
- `GET /api/v1/assistant/status` answers `enabled: false` when no chat provider is configured,
  and lists the providers in the order they are tried (`["groq"]` on Groq alone). The widget is then
  hidden and nothing else is affected.

## 6. Tests

- `npm test` runs the adapter against the stand-in: streaming, tool calls in pieces, every outage
  mode, and embeddings.
- `npm run test:integration` runs `assistant.test.ts`: guests, ownership, live prices, hidden
  products, fallback, limits, retention and admin review. It removes any `GROQ_*`/`OPENAI_*` keys
  from the environment first, so it can never spend real credit.
- `npm run test:db` asserts the assistant's CHECKs and HNSW indexes exist.
- The Playwright suite (`e2e/tests/assistant.spec.ts`) drives the widget against the stand-ins.
- **Answer quality** needs the real providers: `backend/evals/assistant/questions.jsonl` lists
  questions with what a good answer must contain. Running them costs API credit, so it is a manual
  step, before launch and after a prompt or model change.

## 7. Known limitations

- Every policy source is a draft, so policy answers say they are provisional.
- The limiter is per API instance; the database budget is the real cap.
- The FAQ text exists twice: `faqs.ts` for the page and the knowledge files for the assistant.
- Chat text and minimal order data (number, status, dates, tracking, item names) are sent to Groq
  and OpenAI. The privacy notice must say so before launch (PRD §9).
