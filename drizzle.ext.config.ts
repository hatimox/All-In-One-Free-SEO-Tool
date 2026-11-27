// ext: separate drizzle-kit config for extension tables (ext_*), so core
// migrations/snapshots under src/db are never touched.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/ext/db/schema.ts",
  out: "./src/ext/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url: "./data.db" },
  strict: true,
});
