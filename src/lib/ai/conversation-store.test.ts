import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-conv-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiConversations")];
  vi.resetModules();
  const mod = await import("./conversation-store");
  return { mod, dir };
}

const A = "user-a";
const B = "user-b";

describe("conversation store", () => {
  it("creates a conversation with an id + timestamps + owner", async () => {
    const { mod } = await fresh();
    const c = mod.createConversation({ userId: A, title: "Revenue", connectionIds: ["c1"] });
    expect(c.id).toBeTruthy();
    expect(c.title).toBe("Revenue");
    expect(c.connectionIds).toEqual(["c1"]);
    expect(c.messages).toEqual([]);
    expect(c.createdAt).toBeTypeOf("number");
    expect(c.userId).toBe(A);
  });

  it("round-trips messages + working set + owner to disk", async () => {
    const { mod, dir } = await fresh();
    const c = mod.createConversation({ userId: A, title: "X", connectionIds: ["c1", "c2"] });
    mod.updateConversation(c.id, {
      messages: [{ role: "user", content: "hi" }],
      connectionIds: ["c1"],
    }, A);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "ai-conversations", `${c.id}.json`), "utf8"));
    expect(onDisk.messages).toHaveLength(1);
    expect(onDisk.connectionIds).toEqual(["c1"]);
    expect(onDisk.userId).toBe(A);
    expect(mod.getConversation(c.id, A)?.messages[0]).toMatchObject({ role: "user" });
  });

  it("lists lightweight rows newest-first and deletes (scoped to owner)", async () => {
    const { mod } = await fresh();
    const a = mod.createConversation({ userId: A, title: "A", connectionIds: [] });
    const b = mod.createConversation({ userId: A, title: "B", connectionIds: [] });
    mod.updateConversation(a.id, { messages: [{ role: "user", content: "later" }] }, A);
    const list = mod.listConversations(A);
    expect(list.map((r) => r.id)).toContain(a.id);
    expect(list[0]).not.toHaveProperty("messages");
    mod.deleteConversation(b.id, A);
    expect(mod.getConversation(b.id, A)).toBeUndefined();
  });

  it("scopes get/update/delete to the owner (non-owner sees nothing)", async () => {
    const { mod } = await fresh();
    const c = mod.createConversation({ userId: A, title: "secret", connectionIds: ["c1"] });

    // Owner can read/update/delete.
    expect(mod.getConversation(c.id, A)?.title).toBe("secret");

    // Non-owner B is fully blocked — fail closed.
    expect(mod.getConversation(c.id, B)).toBeUndefined();
    expect(mod.updateConversation(c.id, { title: "hacked" }, B)).toBeUndefined();
    expect(mod.deleteConversation(c.id, B)).toBe(false);
    expect(mod.ownsConversation(c.id, B)).toBe(false);
    expect(mod.ownsConversation(c.id, A)).toBe(true);

    // The conversation is untouched + still there for A.
    expect(mod.getConversation(c.id, A)?.title).toBe("secret");
  });

  it("listConversations returns only the viewer's conversations", async () => {
    const { mod } = await fresh();
    const a = mod.createConversation({ userId: A, title: "A's", connectionIds: [] });
    mod.createConversation({ userId: B, title: "B's", connectionIds: [] });
    const listA = mod.listConversations(A);
    expect(listA.map((r) => r.id)).toEqual([a.id]);
    const listB = mod.listConversations(B);
    expect(listB.map((r) => r.title)).toEqual(["B's"]);
  });

  it("hides ownerless legacy conversations from real users (fail closed)", async () => {
    const { mod, dir } = await fresh();
    // Simulate a pre-RBAC conversation persisted with no userId.
    const cdir = path.join(dir, "ai-conversations");
    fs.mkdirSync(cdir, { recursive: true });
    const legacy = {
      id: "legacyid",
      title: "old chat",
      connectionIds: ["c1"],
      messages: [{ role: "user", content: "hi" }],
      createdAt: 1,
      updatedAt: 1,
      // no userId field
    };
    fs.writeFileSync(path.join(cdir, "legacyid.json"), JSON.stringify(legacy));
    // Force a reload from disk.
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.aiConversations")];

    // A real user must not see it.
    expect(mod.listConversations(A)).toEqual([]);
    expect(mod.getConversation("legacyid", A)).toBeUndefined();

    // An empty viewerId (fail-closed / no resolved user) never matches anything,
    // including ownerless legacy rows — they stay invisible to everyone.
    expect(mod.listConversations("")).toEqual([]);
    expect(mod.getConversation("legacyid", "")).toBeUndefined();
    expect(mod.ownsConversation("legacyid", "")).toBe(false);
  });
});
