import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({ user: null as { id: number; role: string } | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "next-action": "abc" }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  accountsEnabled: () => true,
  currentUser: async () => state.user,
}));

const { db } = await import("@/db/client");
const schema = await import("@/db/schema");
const { recordClientId } = await import("./record-scope");
const { runAiCheck, runAllAiChecks, deleteVisibilityCheck } = await import("@/app/ai-visibility/actions");

let own = 0;
let other = 0;
let member = 0;
let ownKw = 0;
let otherKw = 0;
let otherCheck = 0;
let ownCheck = 0;

const mkClient = (name: string) => db.insert(schema.clients).values({ name, url: `https://${name}.test` }).returning({ id: schema.clients.id }).get().id;
const mkKw = (clientId: number, q: string) => db.insert(schema.keywords).values({ clientId, query: q }).returning({ id: schema.keywords.id }).get().id;
const mkCheck = (keywordId: number) =>
  db.insert(schema.aiVisibilityChecks)
    .values({ keywordId, provider: "gemini", prompt: "p", response: "r", mentionsDomain: false } as never)
    .returning({ id: schema.aiVisibilityChecks.id })
    .get().id;
const exists = (id: number) => db.select().from(schema.aiVisibilityChecks).where(eq(schema.aiVisibilityChecks.id, id)).get() != null;

beforeAll(() => {
  own = mkClient("aiv-own");
  other = mkClient("aiv-other");
  member = db.insert(schema.users).values({ email: "aiv-m@t.test", passwordHash: "x", role: "member" }).returning({ id: schema.users.id }).get().id;
  db.insert(schema.clientMembers).values({ userId: member, clientId: own }).run();
  ownKw = mkKw(own, "own kw");
  otherKw = mkKw(other, "other kw");
  ownCheck = mkCheck(ownKw);
  otherCheck = mkCheck(otherKw);
});
beforeEach(() => {
  state.user = { id: member, role: "member" };
});

describe("ai-visibility record scope", () => {
  it("maps a visibility check to its keyword's client", () => {
    expect(recordClientId("visibilityCheck", otherCheck)).toBe(other);
    expect(recordClientId("visibilityCheck", 999999)).toBeNull();
  });

  it("runAiCheck refuses another client's keyword", async () => {
    await expect(runAiCheck(otherKw)).rejects.toThrow(/not found/i);
    // own keyword passes the scope check (then stops at "no provider configured")
    await expect(runAiCheck(ownKw)).resolves.toMatchObject({ ok: false });
  });

  it("deleteVisibilityCheck cannot delete another client's check", async () => {
    await expect(deleteVisibilityCheck(otherCheck)).rejects.toThrow(/not found/i);
    expect(exists(otherCheck)).toBe(true);
    await deleteVisibilityCheck(ownCheck);
    expect(exists(ownCheck)).toBe(false);
  });

  it("runAllAiChecks only sweeps the caller's visible clients", async () => {
    const mine = db.select().from(schema.keywords).where(eq(schema.keywords.clientId, own)).all().length;
    const r = await runAllAiChecks();
    expect(r.ran + r.errored).toBe(mine);
    await expect(runAllAiChecks({ clientId: other })).rejects.toThrow(/not found/i);
  });
});
