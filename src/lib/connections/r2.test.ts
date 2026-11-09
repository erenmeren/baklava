import { describe, it, expect } from "vitest";
import { endpointFor, r2ClientFor } from "./r2";
import { r2Meta } from "@/techs/r2/meta";

// The account id becomes the endpoint's first label; `evil.com/x?` would make
// it https://evil.com/x?.r2.cloudflarestorage.com.
describe("R2 account id", () => {
  it("builds the account endpoint", () => {
    expect(endpointFor("0123456789abcdef0123456789abcdef")).toBe(
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    );
  });

  it("refuses an account id that would pick the host", async () => {
    expect(() => endpointFor("evil.com/x?")).toThrow(/account id/i);
    expect(() => endpointFor("169.254.169.254:80#")).toThrow(/account id/i);
    await expect(
      r2ClientFor("t", { accountId: "evil.com/x?", accessKeyId: "a", secretAccessKey: "s" }),
    ).rejects.toThrow(/account id/i);
  });

  it("the config schema refuses it", () => {
    const ok = { accessKeyId: "a", secretAccessKey: "s" };
    expect(r2Meta.config.schema.safeParse({ ...ok, accountId: "evil.com/x?" }).success).toBe(false);
    expect(r2Meta.config.schema.safeParse({ ...ok, accountId: "0123456789abcdef0123456789abcdef" }).success).toBe(true);
  });
});
