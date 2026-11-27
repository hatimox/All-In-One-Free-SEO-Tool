import { request, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import { AUTH_DIR, BASE_URL, PASSWORD, USERS } from "./env.mjs";

/** Signs each seeded user in over the API and stores the session cookie. */
export default async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  for (const u of USERS) {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const res = await ctx.post("/api/auth/login", { data: { email: u.email, password: PASSWORD } });
    if (!res.ok()) throw new Error(`login failed for ${u.key}: ${res.status()}`);
    await ctx.storageState({ path: `${AUTH_DIR}/${u.key}.json` });
    await ctx.dispose();
  }
}
