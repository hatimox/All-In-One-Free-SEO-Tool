// Builds the throwaway accounts world for the ext suite BEFORE the app
// starts (instrumentation reads "are there accounts?" at boot, and the
// proxy needs that to demand a session). Run from the webServer command.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PASSWORD, USERS } from "./env.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const dbPath = path.resolve(root, process.env.SEO_DB_PATH ?? ".e2e/ext.db");
const dataDir = path.resolve(root, process.env.SEO_DATA_DIR ?? ".e2e/ext-data");

for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

execFileSync("node", ["scripts/migrate.cjs"], { cwd: root, stdio: "inherit", env: process.env });

const Database = require(path.join(root, "node_modules", "better-sqlite3"));
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const hash = (pw) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:1:${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
};

const addClient = db.prepare("INSERT INTO clients (name, url, country) VALUES (?, ?, 'US')");
const A = Number(addClient.run("Client Alpha", "https://alpha.example.invalid").lastInsertRowid);
const B = Number(addClient.run("Client Bravo", "https://bravo.example.invalid").lastInsertRowid);

const addUser = db.prepare(
  "INSERT INTO users (email, password_hash, name, role, active, created_at) VALUES (?, ?, ?, ?, 1, unixepoch())",
);
const ids = {};
for (const u of USERS) ids[u.key] = Number(addUser.run(u.email, hash(PASSWORD), u.name, u.role).lastInsertRowid);

const member = db.prepare("INSERT INTO client_members (user_id, client_id, created_at) VALUES (?, ?, unixepoch())");
member.run(ids.member, A);
member.run(ids.viewer, A);

db.prepare("INSERT INTO keywords (client_id, query, country) VALUES (?, ?, 'US')").run(B, "bravo secret keyword");
db.prepare(
  "INSERT INTO backlinks (client_id, source_url, source_domain, status, source) VALUES (?, ?, ?, 'active', 'manual')",
).run(B, "https://linker.example.invalid/post", "linker.example.invalid");

fs.writeFileSync(path.join(dataDir, "seed.json"), JSON.stringify({ A, B, ids }));
db.close();
console.log(`[e2e-ext] seeded clients A=${A} B=${B}`);
