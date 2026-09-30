import { describe, it, expect } from "vitest";
import { assertNoServerJs } from "./mongo";

describe("assertNoServerJs", () => {
  it.each([
    [{ $where: "while(1){}" }],
    [{ a: { $expr: { $function: { body: "function(){}", args: [], lang: "js" } } } }],
    [{ $or: [{ a: 1 }, { $where: "sleep(1e9)" }] }],
    [[{ $group: { _id: null, x: { $accumulator: {} } } }]],
  ])("rejects %j", (q) => expect(() => assertNoServerJs(q)).toThrow(/server-side JavaScript/));

  it("allows ordinary queries, including a field named like an operator's text", () => {
    expect(() => assertNoServerJs({ status: "$where", n: { $gt: 1 }, tags: { $in: ["a"] } })).not.toThrow();
  });
});
