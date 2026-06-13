import { describe, it, expect } from "vitest";
import { emptyFormState, toFormState, buildSavedConfig, validateFormState, type HeaderRow } from "./form-serialize";

describe("form-serialize", () => {
  it("emptyFormState has one request and none auth", () => {
    const s = emptyFormState();
    expect(s.requests).toHaveLength(1);
    expect(s.auth.type).toBe("none");
  });

  it("buildSavedConfig converts header rows to a record and drops blanks", () => {
    const s = emptyFormState();
    s.target.baseUrl = "https://api.example.com";
    s.requests[0].name = "list";
    s.requests[0].path = "/items";
    s.requests[0].headers = [
      { key: "Accept", value: "application/json" },
      { key: "", value: "" },
    ] as HeaderRow[];
    const cfg = buildSavedConfig(s);
    expect(cfg.target.baseUrl).toBe("https://api.example.com");
    expect(cfg.requests[0].headers).toEqual({ Accept: "application/json" });
  });

  it("buildSavedConfig omits empty checks/body", () => {
    const s = emptyFormState();
    s.target.baseUrl = "https://x.test";
    s.requests[0].name = "a";
    s.requests[0].path = "/";
    const cfg = buildSavedConfig(s);
    expect(cfg.requests[0].body).toBeUndefined();
    expect(cfg.requests[0].checks).toBeUndefined();
  });

  it("round-trips a saved config through toFormState → buildSavedConfig", () => {
    const s = emptyFormState();
    s.target.baseUrl = "https://x.test";
    s.requests[0].name = "a";
    s.requests[0].path = "/a";
    s.auth = { type: "bearer", token: "tok" };
    s.profile = { type: "constant", vus: "3", duration: "10s" };
    const cfg = buildSavedConfig(s);
    const back = buildSavedConfig(toFormState({ name: "T", config: cfg } as never));
    expect(back.profile).toEqual({ type: "constant", vus: 3, duration: "10s" });
    expect(back.requests[0]).toMatchObject({ name: "a", path: "/a", method: "GET" });
  });

  it("validateFormState rejects blank required numbers and names", () => {
    const s = emptyFormState();
    s.name = "T"; s.target.baseUrl = "https://x.test"; s.requests[0].name = "a";
    s.profile = { type: "constant", vus: "", duration: "10s" };
    expect(validateFormState(s)).toMatch(/numeric/i);
    const ok = emptyFormState();
    ok.name = "T"; ok.target.baseUrl = "https://x.test"; ok.requests[0].name = "a";
    expect(validateFormState(ok)).toBeNull();
  });

  it("blanks a secret in edit mode so the API preserves it", () => {
    // toFormState must NOT carry the masked secret into the editable field.
    const masked = { name: "T", config: { ...buildSavedConfig(emptyFormStateWith("https://x.test")), auth: { type: "bearer", token: "••••••••" } } };
    const fs = toFormState(masked as never);
    expect(fs.auth).toEqual({ type: "bearer", token: "" });
  });
});

function emptyFormStateWith(url: string) {
  const s = emptyFormState();
  s.target.baseUrl = url;
  s.requests[0].name = "a";
  s.requests[0].path = "/";
  return s;
}
