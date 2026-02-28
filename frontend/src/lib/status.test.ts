import { bad, ok, pending, status } from "@/lib/status";

import { describe, expect, it } from "vitest";

describe("status helpers", () => {
  it("status() returns a UiStatus", () => {
    expect(status("default", "Hello")).toEqual({
      variant: "default",
      label: "Hello",
    });
  });

  it("ok() returns success", () => {
    expect(ok("OK")).toEqual({ variant: "success", label: "OK" });
  });

  it("bad() returns destructive", () => {
    expect(bad("Nope")).toEqual({ variant: "destructive", label: "Nope" });
  });

  it("pending() returns default", () => {
    expect(pending("Waiting")).toEqual({
      variant: "default",
      label: "Waiting",
    });
  });
});
