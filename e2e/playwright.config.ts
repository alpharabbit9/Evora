import { defineConfig, devices } from "@playwright/test";

import {
  API_URL,
  BACKEND_DIR,
  FAKE_OPENAI_PORT,
  FRONTEND_DIR,
  WEB_URL,
  backendEnv,
  fakeLlmEnv,
  frontendEnv,
} from "./env";

/**
 * Browser journeys against the real stack: the Express API, Better Auth, PostgreSQL, and a
 * production build of the Next.js storefront (`next build` + `next start`, not `next dev`, so
 * what is tested is what ships and no route compiles on first visit mid-test).
 *
 * The API's command migrates and resets `commercecore_e2e` before it listens, so a run always
 * starts from the same fixture and never touches development data. Specs share that database
 * and run one at a time; each registers its own customers, so none depends on another's leftovers.
 *
 * Servers are always started fresh: reusing one left over from an earlier run would mean
 * testing a database that run already changed.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The storefront animates route changes and reveals; reduced motion keeps them short
    // without the suite waiting on arbitrary timeouts.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Stand-ins for Groq and OpenAI, so the shopping assistant runs without a real provider.
      // An unauthenticated request answers 401, which Playwright counts as ready.
      name: "fake-llm",
      cwd: BACKEND_DIR,
      command: "npx tsx scripts/assistant/fake-llm-cli.ts",
      url: `http://127.0.0.1:${String(FAKE_OPENAI_PORT)}/embeddings`,
      env: fakeLlmEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      name: "api",
      cwd: BACKEND_DIR,
      command:
        "npx prisma migrate deploy && npx tsx scripts/e2e/prepare.ts && npx tsx scripts/assistant/index-cli.ts && npx tsx src/server.ts",
      url: `${API_URL}/api/v1/readyz`,
      env: backendEnv(),
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      name: "web",
      cwd: FRONTEND_DIR,
      command: "npx next build && npx next start --port 3010",
      url: WEB_URL,
      env: frontendEnv(),
      reuseExistingServer: false,
      timeout: 600_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
