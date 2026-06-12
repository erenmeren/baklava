import { describe, it, expect } from "vitest";
import { parseK6Progress } from "./progress-parser";

describe("parseK6Progress", () => {
  it("extracts VUs and iteration count from a running line", () => {
    const line = "running (3.0s), 02/02 VUs, 45 complete and 0 interrupted iterations";
    expect(parseK6Progress(line)).toEqual({ vus: 2, iterations: 45 });
  });

  it("extracts from a ramping line with different VU counts", () => {
    expect(parseK6Progress("running (10.5s), 08/20 VUs, 312 complete and 1 interrupted iterations"))
      .toEqual({ vus: 8, iterations: 312 });
  });

  it("returns an empty object for non-progress lines", () => {
    expect(parseK6Progress("some other log line")).toEqual({});
    expect(parseK6Progress("")).toEqual({});
  });
});
