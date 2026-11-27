import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const state = vi.hoisted(() => ({
  inRequest: true,
  accounts: true,
  user: null as { id: number; role: string } | null,
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (!state.inRequest) throw new Error("outside a request scope");
    return new Headers({ "next-action": "abc" });
  },
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  accountsEnabled: () => state.accounts,
  currentUser: async () => state.user,
}));

const { db } = await import("@/db/client");
const schema = await import("@/db/schema");
const { assertRecordClientAccess, assertRecordPageAccess, canAccessRecord, recordClientId } =
  await import("./record-scope");
const { grantCreatorMembership } = await import("./creator-membership");
const { untrackKeyword } = await import("@/app/keywords/actions");
const { deleteBacklink, setBacklinkStatus } = await import("@/app/backlinks/actions");
const { clearRankHistoryAction } = await import("@/app/keywords/rank-actions");

let own = 0;
let other = 0;
let member = 0;
let viewer = 0;
let owner = 0;
let ownKw = 0;
let otherKw = 0;

function mkUser(email: string, role: "owner" | "manager" | "member" | "viewer") {
  return db
    .insert(schema.users)
    .values({ email, passwordHash: "x", role })
    .returning({ id: schema.users.id })
    .get().id;
}
function mkClient(name: string) {
  return db
    .insert(schema.clients)
    .values({ name, url: `https://${name}.test` })
    .returning({ id: schema.clients.id })
    .get().id;
}
function mkKeyword(clientId: number, q: string) {
  return db
    .insert(schema.keywords)
    .values({ clientId, query: q })
    .returning({ id: schema.keywords.id })
    .get().id;
}
function mkBacklink(clientId: number) {
  return db
    .insert(schema.backlinks)
    .values({ clientId, sourceUrl: "https://a.test/x", sourceDomain: "a.test" })
    .returning({ id: schema.backlinks.id })
    .get().id;
}
const kwExists = (id: number) =>
  db.select().from(schema.keywords).where(eq(schema.keywords.id, id)).get() != null;
const blExists = (id: number) =>
  db.select().from(schema.backlinks).where(eq(schema.backlinks.id, id)).get() != null;

beforeAll(() => {
  own = mkClient("own");
  other = mkClient("other");
  owner = mkUser("o@t.test", "owner");
  member = mkUser("m@t.test", "member");
  viewer = mkUser("v@t.test", "viewer");
  db.insert(schema.clientMembers)
    .values([
      { userId: member, clientId: own },
      { userId: viewer, clientId: own },
    ])
    .run();
  ownKw = mkKeyword(own, "own kw");
  otherKw = mkKeyword(other, "other kw");
});

beforeEach(() => {
  state.inRequest = true;
  state.accounts = true;
  state.user = { id: member, role: "member" };
});

describe("recordClientId", () => {
  it("maps records to their client, including keyword children", () => {
    expect(recordClientId("keyword", ownKw)).toBe(own);
    expect(recordClientId("keyword", otherKw)).toBe(other);
    expect(recordClientId("keyword", 99999)).toBeNull();
    expect(recordClientId("keyword", -1)).toBeNull();
    const rankId = db
      .insert(schema.keywordRankings)
      .values({ keywordId: otherKw, position: 3 } as never)
      .returning({ id: schema.keywordRankings.id })
      .get().id;
    expect(recordClientId("ranking", rankId)).toBe(other);
  });
});

describe("assertRecordClientAccess", () => {
  it("lets a member act on their own client's record", async () => {
    await expect(assertRecordClientAccess("keyword", ownKw)).resolves.toBe(own);
  });

  it("hides another client's record from a member, same as a missing one", async () => {
    await expect(assertRecordClientAccess("keyword", otherKw)).rejects.toThrow(/not found/i);
    await expect(assertRecordClientAccess("keyword", 99999)).rejects.toThrow(/not found/i);
  });

  it("keeps viewers read-only but lets them read", async () => {
    state.user = { id: viewer, role: "viewer" };
    await expect(assertRecordClientAccess("keyword", ownKw)).rejects.toThrow(/read-only/);
    await expect(assertRecordClientAccess("keyword", ownKw, "read")).resolves.toBe(own);
  });

  it("lets an owner act on anything", async () => {
    state.user = { id: owner, role: "owner" };
    await expect(assertRecordClientAccess("keyword", otherKw)).resolves.toBe(other);
    await expect(assertRecordClientAccess("keyword", 99999)).resolves.toBeNull();
  });

  it("no-ops without accounts and in background jobs", async () => {
    state.accounts = false;
    state.user = null;
    await expect(assertRecordClientAccess("keyword", otherKw)).resolves.toBe(other);
    state.accounts = true;
    state.inRequest = false;
    await expect(assertRecordClientAccess("keyword", otherKw)).resolves.toBe(other);
  });
});

describe("page / route helpers", () => {
  it("404s a member on another client's record, allows their own", async () => {
    await expect(assertRecordPageAccess("keyword", otherKw)).rejects.toThrow();
    await expect(assertRecordPageAccess("keyword", ownKw)).resolves.toBe(own);
    expect(await canAccessRecord("keyword", otherKw)).toBe(false);
    expect(await canAccessRecord("keyword", ownKw)).toBe(true);
  });
});

describe("real actions", () => {
  it("member cannot untrack another client's keyword, can untrack their own", async () => {
    const k1 = mkKeyword(other, "x1");
    await expect(untrackKeyword(k1)).rejects.toThrow(/not found/i);
    expect(kwExists(k1)).toBe(true);
    const k2 = mkKeyword(own, "x2");
    await untrackKeyword(k2);
    expect(kwExists(k2)).toBe(false);
  });

  it("member cannot delete or change another client's backlink", async () => {
    const b = mkBacklink(other);
    await expect(deleteBacklink(b)).rejects.toThrow(/not found/i);
    await expect(setBacklinkStatus(b, "lost")).rejects.toThrow(/not found/i);
    expect(blExists(b)).toBe(true);
    const mine = mkBacklink(own);
    await deleteBacklink(mine);
    expect(blExists(mine)).toBe(false);
  });

  it("viewer cannot edit even on their own client", async () => {
    state.user = { id: viewer, role: "viewer" };
    const k = mkKeyword(own, "v");
    await expect(untrackKeyword(k)).rejects.toThrow(/read-only/);
    const b = mkBacklink(own);
    await expect(deleteBacklink(b)).rejects.toThrow(/read-only/);
  });

  it("owner can delete across clients", async () => {
    state.user = { id: owner, role: "owner" };
    const k = mkKeyword(other, "o");
    await untrackKeyword(k);
    expect(kwExists(k)).toBe(false);
    const b = mkBacklink(other);
    await deleteBacklink(b);
    expect(blExists(b)).toBe(false);
  });

  it("clearRankHistoryAction refuses ids of another client", async () => {
    await expect(clearRankHistoryAction([ownKw, otherKw])).rejects.toThrow(/not found/i);
  });
});

describe("grantCreatorMembership", () => {
  const members = (uid: number, cid: number) =>
    db.select().from(schema.clientMembers).where(eq(schema.clientMembers.clientId, cid)).all()
      .filter((r) => r.userId === uid);

  it("adds a member as a member of the client they created (idempotent)", async () => {
    const c = mkClient("created");
    await grantCreatorMembership(c);
    await grantCreatorMembership(c);
    expect(members(member, c)).toHaveLength(1);
    expect(await canAccessRecordClient(c)).toBe(true);
  });

  it("does nothing for owners, without accounts, or outside a request", async () => {
    const c = mkClient("created2");
    state.user = { id: owner, role: "owner" };
    await grantCreatorMembership(c);
    state.user = { id: member, role: "member" };
    state.accounts = false;
    await grantCreatorMembership(c);
    expect(members(member, c)).toHaveLength(0);
  });
});

async function canAccessRecordClient(clientId: number) {
  const { canSeeClient } = await import("@/lib/auth");
  const u = db.select().from(schema.users).where(eq(schema.users.id, member)).get()!;
  return canSeeClient(u, clientId);
}
