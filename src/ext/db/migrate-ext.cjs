// Extension migration runner (ext_* tables). Called from scripts/migrate.cjs
// AFTER the core migrations, with the already-open better-sqlite3 handle.
//
// CJS for the same reason migrate.cjs is: it runs in the minimal Docker
// image before any TS tooling. Files in src/ext/db/migrations/*.sql are
// recorded in __drizzle_migrations as `ext/<filename>` so they can never
// collide with upstream names, and there is deliberately NO "schema already
// exists, mark everything applied" heuristic here: an ext migration is only
// recorded after it actually ran (or after every statement was a benign
// "already exists" no-op).
const fs = require("node:fs");
const path = require("node:path");

function run(sqlite) {
  const dir = path.join(__dirname, "migrations");
  if (!fs.existsSync(dir)) return 0;
  // The core runner may have skipped creating this table (no core migrations dir).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER
    );
  `);
  const applied = new Set(
    sqlite.prepare("SELECT hash FROM __drizzle_migrations").all().map((r) => r.hash),
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const record = sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  let count = 0;
  for (const f of files) {
    const key = `ext/${f}`;
    if (applied.has(key)) continue;
    const statements = fs
      .readFileSync(path.join(dir, f), "utf-8")
      .split(/-->\s*statement-breakpoint/i)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      sqlite.transaction(() => {
        for (const s of statements) sqlite.exec(s);
        record.run(key, Date.now());
      })();
    } catch (err) {
      if (!/already exists|duplicate column/i.test(err.message)) {
        console.error(`[migrate] failed on ${key}:`, err.message);
        process.exit(1);
      }
      // Partial earlier run: replay statement by statement, skipping no-ops.
      for (const s of statements) {
        try {
          sqlite.exec(s);
        } catch (e2) {
          if (/already exists|duplicate column/i.test(e2.message)) continue;
          console.error(`[migrate] failed on ${key}:`, e2.message);
          process.exit(1);
        }
      }
      record.run(key, Date.now());
    }
    count += 1;
    console.log(`[migrate] applied ${key}`);
  }
  return count;
}

module.exports = { run };
