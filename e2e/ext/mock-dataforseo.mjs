// Tiny DataForSEO mock for the ext e2e suite. No dependencies.
//   GET  /__calls   -> recorded requests (in memory)
//   POST /__reset   -> clear calls and queue state
// Standard-queue tasks become ready on the SECOND tasks_ready poll after
// the task was posted. Responses come from fixtures/dataforseo/*.json.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "..", "..", "fixtures", "dataforseo");
const PORT = Number(process.env.MOCK_DFS_PORT ?? 3212);

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), "utf8"));

/** @type {{method:string, path:string, body:unknown}[]} */
let calls = [];
let readyPolls = 0;
let postedKeywords = [];

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function volumeRows(keywords) {
  const known = new Map(fixture("volume_live").tasks[0].result.map((r) => [r.keyword, r]));
  return keywords.map(
    (k) => known.get(k) ?? { ...known.get("seo tool"), keyword: k, search_volume: 100 },
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    if (p === "/__calls") return send(res, 200, calls);
    if (p === "/__reset") {
      calls = [];
      readyPolls = 0;
      postedKeywords = [];
      return send(res, 200, { ok: true });
    }
    calls.push({ method: req.method ?? "GET", path: p, body });

    if (p === "/v3/appendix/user_data") return send(res, 200, fixture("user_data"));

    const vol = "/v3/keywords_data/google_ads/search_volume";
    if (p === `${vol}/task_post`) {
      readyPolls = 0;
      postedKeywords = Array.isArray(body) ? (body[0]?.keywords ?? []) : [];
      return send(res, 200, fixture("volume_task_post"));
    }
    if (p === `${vol}/tasks_ready`) {
      readyPolls += 1;
      if (readyPolls < 2) {
        const f = fixture("volume_tasks_ready");
        f.tasks[0].result = [];
        f.tasks[0].result_count = 0;
        return send(res, 200, f);
      }
      return send(res, 200, fixture("volume_tasks_ready"));
    }
    if (p.startsWith(`${vol}/task_get/`)) {
      const f = fixture("volume_live");
      f.tasks[0].cost = 0;
      f.tasks[0].result = volumeRows(postedKeywords.length ? postedKeywords : ["seo tool"]);
      return send(res, 200, f);
    }
    if (p === `${vol}/live`) {
      const f = fixture("volume_live");
      const kws = Array.isArray(body) ? (body[0]?.keywords ?? []) : [];
      f.tasks[0].result = volumeRows(kws.length ? kws : ["seo tool"]);
      return send(res, 200, f);
    }
    // Labs (difficulty, intent, ideas, domain data): valid but empty live results.
    if (p.startsWith("/v3/dataforseo_labs/") && p.endsWith("/live")) {
      return send(res, 200, {
        version: "0.1.2024", status_code: 20000, status_message: "Ok.", time: "0.1 sec.", cost: 0.012, tasks_count: 1, tasks_error: 0,
        tasks: [{ id: "00000000-0000-0000-0000-000000000002", status_code: 20000, status_message: "Ok.", time: "0.1 sec.", cost: 0.012, result_count: 1, path: ["v3"], data: {}, result: [{ total_count: 0, items_count: 0, items: [] }] }],
      });
    }
    return send(res, 404, { status_code: 40400, status_message: "Not Found." });
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-dataforseo] listening on ${PORT}`));
