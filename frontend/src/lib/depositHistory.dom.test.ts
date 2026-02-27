import {
  addRecentDepositId,
  clearRecentDepositIds,
  getRecentDepositIds,
} from "@/lib/depositHistory";

import { beforeEach, describe, expect, it } from "vitest";

describe("depositHistory (browser)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns [] when no storage value exists", () => {
    expect(getRecentDepositIds()).toEqual([]);
  });

  it("filters invalid and non-string values", () => {
    window.localStorage.setItem(
      "greenreserve.recentDepositIds",
      JSON.stringify(["a", 1, null, "b", { c: true }]),
    );
    expect(getRecentDepositIds()).toEqual(["a", "b"]);
  });

  it("addRecentDepositId() trims and dedupes", () => {
    addRecentDepositId("  dep1  ");
    addRecentDepositId("dep2");
    addRecentDepositId("dep1");

    expect(getRecentDepositIds()).toEqual(["dep1", "dep2"]);
  });

  it("caps to 10 entries", () => {
    for (let i = 0; i < 12; i += 1) {
      addRecentDepositId(`dep${i}`);
    }
    expect(getRecentDepositIds()).toHaveLength(10);
    expect(getRecentDepositIds()[0]).toBe("dep11");
  });

  it("clearRecentDepositIds() removes key", () => {
    addRecentDepositId("dep1");
    expect(getRecentDepositIds()).toEqual(["dep1"]);

    clearRecentDepositIds();
    expect(getRecentDepositIds()).toEqual([]);
  });
});
