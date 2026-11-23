#!/usr/bin/env node
/**
 * Defined load test (M12, docs/load-test.md). No dependencies: Node 22+ only.
 *
 *   node deploy/load/load-test.mjs http://localhost:8080
 *   STAGES=10,50,100 STAGE_SECONDS=60 node deploy/load/load-test.mjs https://staging.example.com
 *
 * Closed loop (STAGES, the default): each virtual shopper sends its next request as soon as the
 * last one answers, so a stage measures the most the deployment serves at that concurrency.
 * Open loop (RATES=5,10,20): requests arrive at a fixed rate whether or not earlier ones have
 * answered, as independent shoppers do, so a stage shows the latency at a defined load. The mix is browsing, the
 * traffic that dominates a store. Checkout is not in it: every write route is rate limited per
 * client IP (ADR 0009), and a generator on one machine is one IP, so it would measure the
 * limiter. Checkout's concurrency behaviour is proven by the integration suite instead.
 *
 * Never point it at production without warning whoever is on call: it is designed to saturate.
 */

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node deploy/load/load-test.mjs <origin>');
  process.exit(2);
}

const api = `${(process.env.LOAD_API_URL ?? base).replace(/\/$/, '')}/api/v1`;
const rates = process.env.RATES ? process.env.RATES.split(',').map(Number) : null;
const stages = rates ?? (process.env.STAGES ?? '5,10,25,50,100').split(',').map(Number);
const stageSeconds = Number(process.env.STAGE_SECONDS ?? 30);
const outFile = process.env.LOAD_OUT;

// A pool of real slugs and search words, so requests hit varied rows rather than one cache line.
const seed = await (await fetch(`${api}/products?pageSize=48&sort=newest`)).json();
const slugs = (seed.data ?? []).map((product) => product.slug);
if (slugs.length === 0) {
  console.error('The catalog is empty: load the catalog first (docs/load-test.md).');
  process.exit(2);
}
const words = ['jacket', 'black', 'leather', 'dress', 'boots', 'linen', 'shirt', 'coat'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Weighted browse mix: what a shopper does between landing and leaving. */
const MIX = [
  { name: 'api listing (featured)', weight: 25, url: () => `${api}/products?page=${1 + Math.floor(Math.random() * 5)}` },
  { name: 'api listing (filtered, by price)', weight: 10, url: () => `${api}/products?gender=men&sort=price_asc` },
  { name: 'api facets', weight: 10, url: () => `${api}/products/facets` },
  { name: 'api search', weight: 10, url: () => `${api}/products?q=${pick(words)}` },
  { name: 'api product detail', weight: 15, url: () => `${api}/products/${pick(slugs)}` },
  { name: 'page product (SSR)', weight: 15, url: () => `${base}/products/${pick(slugs)}` },
  { name: 'page shop', weight: 10, url: () => `${base}/shop` },
  { name: 'page home', weight: 5, url: () => `${base}/` },
];
const totalWeight = MIX.reduce((sum, entry) => sum + entry.weight, 0);
function choose() {
  let roll = Math.random() * totalWeight;
  for (const entry of MIX) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return MIX[0];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function one(samples) {
  const entry = choose();
  const started = performance.now();
  let ok = false;
  let status = 0;
  try {
    const res = await fetch(entry.url(), { signal: AbortSignal.timeout(30_000) });
    status = res.status;
    await res.arrayBuffer();
    ok = res.status === 200;
  } catch {
    ok = false;
  }
  samples.push({ name: entry.name, ms: performance.now() - started, ok, status });
}

/** Closed loop: `concurrency` shoppers, each sending its next request when the last answers. */
async function runStage(concurrency) {
  const samples = [];
  const deadline = performance.now() + stageSeconds * 1000;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) await one(samples);
    }),
  );
  return summarise(concurrency, samples, (performance.now() - started) / 1000);
}

/** Open loop: one request every 1/rate seconds, never waiting for earlier ones to answer. */
async function runRate(rate) {
  const samples = [];
  const inFlight = [];
  const started = performance.now();
  const total = Math.round(rate * stageSeconds);
  for (let i = 0; i < total; i += 1) {
    const wait = started + (i * 1000) / rate - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    inFlight.push(one(samples));
  }
  await Promise.all(inFlight);
  return summarise(rate, samples, (performance.now() - started) / 1000);
}

function summarise(concurrency, samples, seconds) {
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const errors = samples.filter((sample) => !sample.ok);
  const byEndpoint = {};
  for (const entry of MIX) {
    const own = samples.filter((sample) => sample.name === entry.name).map((s) => s.ms).sort((a, b) => a - b);
    byEndpoint[entry.name] = { count: own.length, p50: percentile(own, 50), p95: percentile(own, 95) };
  }

  return {
    concurrency,
    requests: samples.length,
    rps: samples.length / seconds,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    errorRate: samples.length ? errors.length / samples.length : 0,
    errorStatuses: [...new Set(errors.map((error) => error.status))],
    byEndpoint,
  };
}

console.log(`Load test against ${base}: stages ${stages.join(', ')} × ${stageSeconds}s, ${slugs.length} products in the pool\n`);
console.log(`${rates ? 'target/s' : 'shoppers'}    req/s     p50 ms    p95 ms    p99 ms   errors`);
const report = [];
for (const concurrency of stages) {
  const stage = rates ? await runRate(concurrency) : await runStage(concurrency);
  report.push(stage);
  console.log(
    `${String(concurrency).padStart(8)} ${stage.rps.toFixed(1).padStart(8)} ${stage.p50.toFixed(0).padStart(10)} ${stage.p95
      .toFixed(0)
      .padStart(9)} ${stage.p99.toFixed(0).padStart(9)} ${(stage.errorRate * 100).toFixed(2).padStart(7)}%${
      stage.errorStatuses.length ? `  (${stage.errorStatuses.join(',')})` : ''
    }`,
  );
}

const last = report.at(-1);
console.log(`\nAt ${last.concurrency} ${rates ? 'requests/s' : 'shoppers'}, per endpoint:`);
for (const [name, value] of Object.entries(last.byEndpoint)) {
  console.log(`  ${name.padEnd(34)} n=${String(value.count).padStart(6)}  p50 ${value.p50.toFixed(0).padStart(5)} ms  p95 ${value.p95.toFixed(0).padStart(5)} ms`);
}

if (outFile) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outFile, JSON.stringify({ base, stageSeconds, at: new Date().toISOString(), report }, null, 2));
  console.log(`\nWrote ${outFile}`);
}
