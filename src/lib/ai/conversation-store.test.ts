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

describe("conversation store", () => {
  it("creates a conversation with an id + timestamps", async () => {
    const { mod } = await fresh();
    const c = mod.createConversation({ title: "Revenue", connectionIds: ["c1"] });
    expect(c.id).toBeTruthy();
    expect(c.title).toBe("Revenue");
    expect(c.connectionIds).toEqual(["c1"]);
    expect(c.messages).toEqual([]);
    expect(c.createdAt).toBeTypeOf("number");
  });

  it("round-trips messages + working set to disk", async () => {
    const { mod, dir } = await fresh();
    const c = mod.createConversation({ title: "X", connectionIds: ["c1", "c2"] });
    mod.updateConversation(c.id, {
      messages: [{ role: "user", content: "hi" }],
      connectionIds: ["c1"],
    });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "ai-conversations", `${c.id}.json`), "utf8"));
    expect(onDisk.messages).toHaveLength(1);
    expect(onDisk.connectionIds).toEqual(["c1"]);
    expect(mod.getConversation(c.id)?.messages[0]).toMatchObject({ role: "user" });
  });

  it("lists lightweight rows newest-first and deletes", async () => {
    const { mod } = await fresh();
    const a = mod.createConversation({ title: "A", connectionIds: [] });
    const b = mod.createConversation({ title: "B", connectionIds: [] });
    mod.updateConversation(a.id, { messages: [{ role: "user", content: "later" }] });
    const list = mod.listConversations();
    expect(list.map((r) => r.id)).toContain(a.id);
    expect(list[0]).not.toHaveProperty("messages");
    mod.deleteConversation(b.id);
    expect(mod.getConversation(b.id)).toBeUndefined();
  });
});
