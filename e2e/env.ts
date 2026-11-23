import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";

import { E2E_ADMIN } from "./fixtures";

/**
 * Where the suite runs everything. Ports are one apart from development's (3000/4000) so a dev
 * server and an E2E run never fight, and the database is its own, because the fixture
 * truncates every table (`backend/scripts/e2e/prepare.ts` refuses any other name).
 */
export const API_PORT = 4010;
export const WEB_PORT = 3010;
export const API_URL = `http://localhost:${String(API_PORT)}`;
export const WEB_URL = `http://localhost:${String(WEB_PORT)}`;
/** The stand-in Groq and OpenAI (`backend/scripts/assistant/fake-llm-cli.ts`, ADR 0025). */
export const FAKE_GROQ_PORT = 4120;
export const FAKE_OPENAI_PORT = 4121;

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(here, "../backend");
export const FRONTEND_DIR = path.resolve(here, "../frontend");
export const MAIL_ROOT = path.join(BACKEND_DIR, ".data/e2e/mail");
const MEDIA_ROOT = path.join(BACKEND_DIR, ".data/e2e/media");

function backendDotenv(): Record<string, string> {
  try {
    return parse(readFileSync(path.join(BACKEND_DIR, ".env")));
  } catch {
    return {};
  }
}

/**
 * DATABASE_URL_E2E if set (CI sets it), otherwise the local test database's server with the
 * database name swapped for `commercecore_e2e` — same credentials, separate data.
 */
export function e2eDatabaseUrl(): string {
  const local = backendDotenv();
  const explicit = process.env.DATABASE_URL_E2E ?? local.DATABASE_URL_E2E;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL_TEST ?? local.DATABASE_URL_TEST;
  if (!base) {
    throw new Error(
      "Set DATABASE_URL_E2E (or DATABASE_URL_TEST in backend/.env) so the E2E suite has a " +
        "PostgreSQL server to create commercecore_e2e on.",
    );
  }

  const url = new URL(base);
  url.pathname = "/commercecore_e2e";
  return url.toString();
}

/**
 * The API's environment for a run. Every value that could otherwise come from backend/.env and
 * change the outcome is pinned here: dotenv never overrides a variable that is already set.
 * Online payment is switched off (empty store id and password), so the journey is cash on
 * delivery; the SSLCOMMERZ flows are covered by `backend/tests/integration/payments.test.ts`.
 */
export function backendEnv(): Record<string, string> {
  return {
    NODE_ENV: "development",
    PORT: String(API_PORT),
    LOG_LEVEL: "warn",
    DATABASE_URL: e2eDatabaseUrl(),
    BETTER_AUTH_URL: API_URL,
    FRONTEND_ORIGIN: WEB_URL,
    PAYMENT_CALLBACK_BASE_URL: API_URL,
    STORAGE_DRIVER: "filesystem",
    MEDIA_ROOT,
    MEDIA_PUBLIC_URL: `${API_URL}/media`,
    EMAIL_DRIVER: "filesystem",
    MAIL_ROOT,
    SSLCOMMERZ_STORE_ID: "",
    SSLCOMMERZ_STORE_PASSWORD: "",
    E2E_ADMIN_EMAIL: E2E_ADMIN.email,
    E2E_ADMIN_PASSWORD: E2E_ADMIN.password,
    // The shopping assistant talks to the local stand-ins, never a real provider; the keys are
    // the stand-ins' own fixed test values.
    GROQ_BASE_URL: `http://127.0.0.1:${String(FAKE_GROQ_PORT)}`,
    GROQ_API_KEY: "local-fake-groq-key",
    GROQ_CHAT_MODEL: "fake-groq-model",
    OPENAI_BASE_URL: `http://127.0.0.1:${String(FAKE_OPENAI_PORT)}`,
    OPENAI_API_KEY: "local-fake-openai-key",
    OPENAI_CHAT_MODEL: "fake-openai-model",
  };
}

export function fakeLlmEnv(): Record<string, string> {
  return {
    FAKE_GROQ_PORT: String(FAKE_GROQ_PORT),
    FAKE_OPENAI_PORT: String(FAKE_OPENAI_PORT),
  };
}

export function frontendEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_API_URL: API_URL,
    // Canonical links, the sitemap and link previews point at the storefront under test.
    NEXT_PUBLIC_SITE_URL: WEB_URL,
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}
