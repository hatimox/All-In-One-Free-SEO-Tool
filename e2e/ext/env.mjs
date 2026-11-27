// Shared constants for the ext e2e suite (config, seed, specs).
export const PORT = Number(process.env.E2E_EXT_PORT ?? 3211);
export const MOCK_PORT = Number(process.env.E2E_EXT_MOCK_PORT ?? 3212);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
// Throwaway test values, not secrets.
export const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
export const SESSION_SECRET = "e2e-ext-session-secret-not-for-production-use";
export const PASSWORD = "correct-horse-battery-1";
export const USERS = [
  { key: "owner", email: "owner@e2e.invalid", name: "E2E Owner", role: "owner" },
  { key: "member", email: "member@e2e.invalid", name: "E2E Member", role: "member" },
  { key: "viewer", email: "viewer@e2e.invalid", name: "E2E Viewer", role: "viewer" },
];
export const AUTH_DIR = ".e2e/ext-auth";
