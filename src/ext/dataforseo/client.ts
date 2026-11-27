/**
 * Minimal DataForSEO HTTP client: Basic auth, JSON, timeout, bounded
 * concurrency, retry with backoff, typed envelope, redacted errors.
 *
 * Docs: https://docs.dataforseo.com/v3/ (envelope: status_code, cost,
 * tasks[].status_code/cost/result; errors appendix:
 * https://docs.dataforseo.com/v3/appendix/errors/).
 *
 * Status codes used here:
 *   20000 ok, 20100 task created
 *   40202 per-minute rate limit  -> retry with backoff
 *   40209 too many simultaneous  -> retry with backoff
 *   40210 / HTTP 402 insufficient funds -> NOT retried, clear message
 *   40100 / HTTP 401 bad credentials    -> NOT retried
 *   50000..50999 server side     -> retry (except 50100 not implemented)
 *
 * Credentials and the Authorization header never appear in thrown
 * messages: every message passes through `redact()`.
 */
import { apiBase, getCredentials, type Credentials } from "./config";

export type DfsTask<R = unknown> = {
  id: string;
  status_code: number;
  status_message: string;
  cost?: number;
  result_count?: number;
  path?: string[];
  data?: Record<string, unknown>;
  result: R[] | null;
};

export type DfsEnvelope<R = unknown> = {
  version?: string;
  status_code: number;
  status_message: string;
  cost?: number;
  tasks_count?: number;
  tasks_error?: number;
  tasks: DfsTask<R>[];
};

export class DataForSeoError extends Error {
  /** DataForSEO status code (or HTTP status when no envelope), null for network errors. */
  readonly code: number | null;
  readonly retryable: boolean;
  /**
   * True when the request may have reached DataForSEO (network error or
   * timeout after sending), so a paid call may already have been billed.
   */
  readonly ambiguous: boolean;
  constructor(message: string, code: number | null, retryable = false, ambiguous = false) {
    super(message);
    this.name = "DataForSeoError";
    this.code = code;
    this.retryable = retryable;
    this.ambiguous = ambiguous;
  }
}

export const INSUFFICIENT_FUNDS_MESSAGE =
  "DataForSEO balance is empty — top up your DataForSEO account to continue.";

/** Strip credentials, Authorization headers and base64 forms from a message. */
export function redact(text: string, creds?: Credentials | null): string {
  let out = String(text);
  if (creds) {
    const basic = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
    for (const secret of [basic, creds.password, creds.login]) {
      if (secret) out = out.split(secret).join("[redacted]");
    }
  }
  out = out.replace(/(authorization["']?\s*[:=]\s*["']?)(basic|bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1[redacted]");
  out = out.replace(/Basic\s+[A-Za-z0-9+/=]{8,}/g, "Basic [redacted]");
  return out;
}

/**
 * Codes meaning "rejected before any work/charge": the only ones a POST
 * (paid live / task_post) may be retried on. Network errors and timeouts
 * are NOT in this set: DataForSEO may already have billed the call.
 */
const NOT_CHARGED_CODES = new Set([40202, 40209, 429]);

const RETRY_CODES = new Set([40202, 40209, 50000, 50301, 50303, 50304, 50401, 50402]);

const opts = { timeoutMs: 60_000, maxRetries: 3, retryBaseMs: 1000, maxConcurrency: 4 };

/** Test hook (and tuning knob). */
export function configureClient(patch: Partial<typeof opts>): void {
  Object.assign(opts, patch);
}

// --- tiny semaphore --------------------------------------------------------
let active = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < opts.maxConcurrency) {
    active++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
}
function release(): void {
  const next = waiters.shift();
  if (next) next(); // slot handed over, active unchanged
  else active--;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function costToMicros(usd: number | undefined | null): number {
  return typeof usd === "number" && Number.isFinite(usd) ? Math.round(usd * 1_000_000) : 0;
}

function describe(code: number | null, message: string): DataForSeoError {
  if (code === 40210 || code === 402 || code === 40200) {
    return new DataForSeoError(INSUFFICIENT_FUNDS_MESSAGE, code, false);
  }
  if (code === 401 || code === 40100) {
    return new DataForSeoError("DataForSEO rejected the credentials (check login and API password).", code, false);
  }
  return new DataForSeoError(`DataForSEO error ${code ?? "?"}: ${message}`, code, code !== null && RETRY_CODES.has(code));
}

async function once<R>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  creds: Credentials,
): Promise<DfsEnvelope<R>> {
  const auth = "Basic " + Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    throw new DataForSeoError(
      redact(aborted ? "DataForSEO request timed out." : `DataForSEO network error: ${(err as Error)?.message}`, creds),
      null,
      true,
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  let json: DfsEnvelope<R> | null = null;
  try {
    json = (await res.json()) as DfsEnvelope<R>;
  } catch {
    /* non-JSON body */
  }
  if (!json || typeof json.status_code !== "number") {
    const retry = res.status >= 500 || res.status === 429;
    const e = res.status === 402 || res.status === 401
      ? describe(res.status, res.statusText)
      : new DataForSeoError(redact(`DataForSEO HTTP ${res.status} ${res.statusText}`, creds), res.status, retry);
    throw e;
  }
  if (json.status_code !== 20000) {
    const e = describe(json.status_code, redact(json.status_message ?? "", creds));
    throw new DataForSeoError(redact(e.message, creds), e.code, e.retryable, e.ambiguous);
  }
  return json;
}

/**
 * Send one request. Throws DataForSeoError when the envelope itself fails.
 * Per-task failures are NOT thrown here (a task_post can have partial
 * success); use `assertTaskOk` on the tasks you rely on.
 */
export async function dfsRequest<R = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<DfsEnvelope<R>> {
  const creds = await getCredentials();
  if (!creds) throw new DataForSeoError("DataForSEO is not configured.", null, false);
  await acquire();
  try {
    let attempt = 0;
    for (;;) {
      try {
        return await once<R>(method, path, body, creds);
      } catch (err) {
        const e = err as DataForSeoError;
        const retryOk =
          e instanceof DataForSeoError &&
          e.retryable &&
          (method === "GET" || (e.code !== null && NOT_CHARGED_CODES.has(e.code)));
        if (!retryOk || attempt >= opts.maxRetries) {
          throw e instanceof DataForSeoError
            ? e
            : new DataForSeoError(redact((e as Error)?.message ?? "unknown error", creds), null, false, true);
        }
        attempt++;
        await sleep(opts.retryBaseMs * 2 ** (attempt - 1));
      }
    }
  } finally {
    release();
  }
}

const TASK_OK = new Set([20000, 20100]);

/** Throw if a task did not succeed (maps balance errors to the friendly message). */
export function assertTaskOk(task: DfsTask | undefined, what = "task"): asserts task is DfsTask {
  if (!task) throw new DataForSeoError(`DataForSEO returned no ${what}.`, null, false);
  if (!TASK_OK.has(task.status_code)) {
    throw describe(task.status_code, task.status_message ?? "task failed");
  }
}

/** Convenience: POST a single-task live endpoint and return the first task. */
export async function dfsLive<R = unknown>(path: string, task: Record<string, unknown>): Promise<DfsTask<R>> {
  const env = await dfsRequest<R>("POST", path, [task]);
  const t = env.tasks?.[0];
  assertTaskOk(t);
  return t as DfsTask<R>;
}

/** Bad credentials or empty balance: an account problem, not a problem with the task. */
export function isAuthOrFundsError(e: unknown): boolean {
  return e instanceof DataForSeoError && e.code !== null && [401, 40100, 402, 40200, 40210].includes(e.code);
}
