import { describe, it, expect } from "vitest";
import { resolveEndpoint } from "./minio";

describe("resolveEndpoint", () => {
  it("prefixes http when no scheme and SSL off", () => {
    expect(resolveEndpoint({ endpoint: "localhost:9000", useSSL: false } as never)).toBe("http://localhost:9000");
  });
  it("prefixes https when no scheme and SSL on", () => {
    expect(resolveEndpoint({ endpoint: "minio.example.com", useSSL: true } as never)).toBe("https://minio.example.com");
  });
  it("uses an explicit http(s) URL verbatim, ignoring the toggle", () => {
    expect(resolveEndpoint({ endpoint: "https://m.example.com:9000", useSSL: false } as never)).toBe("https://m.example.com:9000");
    expect(resolveEndpoint({ endpoint: "http://localhost:9000", useSSL: true } as never)).toBe("http://localhost:9000");
  });
  it("trims whitespace", () => {
    expect(resolveEndpoint({ endpoint: "  localhost:9000  ", useSSL: false } as never)).toBe("http://localhost:9000");
  });
});
