import { defineConfig, devices } from "@playwright/test";
import {
  BASE_URL,
  ENCRYPTION_KEY,
  MOCK_PORT,
  MOCK_URL,
  PORT,
  SESSION_SECRET,
} from "./e2e/ext/env.mjs";

/**
 * Extension e2e (accounts + DataForSEO), isolated from the main suite:
 * own port, own database (.e2e/ext.db), own data dir, and a mock
 * DataForSEO server so nothing here can spend real money.
 *
 * Like the main config it serves an EXISTING production build
 * (`pnpm build` first). The seed script resets the database and creates
 * the accounts BEFORE the app boots, which the app requires: whether
 * accounts exist is read once at startup.
 *
 *   pnpm build && pnpm test:e2e:ext
 */
export default defineConfig({
  testDir: "./e2e/ext",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/ext/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  // The pending screen polls every 15s, so a full lookup takes ~20s.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "node e2e/ext/mock-dataforseo.mjs",
      url: `${MOCK_URL}/__calls`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { MOCK_DFS_PORT: String(MOCK_PORT) },
    },
    {
      command: `node e2e/ext/seed.mjs && npx next start -p ${PORT}`,
      url: `${BASE_URL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        SEO_DB_PATH: ".e2e/ext.db",
        SEO_DATA_DIR: ".e2e/ext-data",
        SEO_DISABLE_SCHEDULER: "1",
        SEO_ENCRYPTION_KEY: ENCRYPTION_KEY,
        SEO_SESSION_SECRET: SESSION_SECRET,
        DATAFORSEO_API_BASE: MOCK_URL,
        // Make sure the env fallback cannot mask the Settings UI test.
        DATAFORSEO_LOGIN: "",
        DATAFORSEO_PASSWORD: "",
      },
    },
  ],
});
