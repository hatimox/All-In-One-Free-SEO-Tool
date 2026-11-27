import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const TABLES = ["ext_dfs_alerts", "ext_dfs_cache", "ext_dfs_ledger", "ext_dfs_requests", "ext_keyword_metrics", "ext_mcp_tokens"];

function migrate(dbPath: string) {
  execFileSync(process.execPath, [path.join(process.cwd(), "scripts", "migrate.cjs")], {
    env: { ...process.env, SEO_DB_PATH: dbPath },
    stdio: "pipe",
  });
}
const names = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);

describe("ext migrations", () => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "seo-ext-mig-")), "t.db");

  it("a fresh DB gets every ext_ table, recorded as ext/<file>", () => {
    migrate(dbPath);
    const db = new Database(dbPath);
    for (const t of TABLES) expect(names(db)).toContain(t);
    const hashes = (db.prepare("SELECT hash FROM __drizzle_migrations").all() as { hash: string }[]).map((r) => r.hash);
    expect(hashes.some((h) => h.startsWith("ext/0000_"))).toBe(true);
    db.close();
  });

  it("rerunning is idempotent", () => {
    const count = () => {
      const db = new Database(dbPath);
      const n = (db.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE hash LIKE 'ext/%'").get() as { n: number }).n;
      db.close();
      return n;
    };
    const before = count();
    migrate(dbPath);
    expect(count()).toBe(before);
  });

  it("recovers when an ext table was dropped but migration unrecorded", () => {
    const db = new Database(dbPath);
    db.exec("DELETE FROM __drizzle_migrations WHERE hash LIKE 'ext/%'");
    db.exec("DROP TABLE ext_mcp_tokens");
    db.close();
    migrate(dbPath);
    const d2 = new Database(dbPath);
    expect(names(d2)).toContain("ext_mcp_tokens");
    d2.close();
  });
});

describe("migrate-ext runner", () => {
  it("creates __drizzle_migrations itself when the core runner never did", () => {
    const db = new Database(":memory:");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { run } = require(path.join(process.cwd(), "src", "ext", "db", "migrate-ext.cjs"));
    expect(run(db)).toBeGreaterThan(0);
    for (const t of TABLES) expect(names(db)).toContain(t);
    db.close();
  });
});
