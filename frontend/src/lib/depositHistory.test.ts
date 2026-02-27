import {
  addRecentDepositId,
  clearRecentDepositIds,
  getRecentDepositIds,
} from "@/lib/depositHistory";

import { describe, expect, it } from "vitest";

describe("depositHistory (node)", () => {
  it("getRecentDepositIds() returns empty array on server", () => {
    expect(getRecentDepositIds()).toEqual([]);
  });

  it("addRecentDepositId() is a no-op on server", () => {
    expect(() => addRecentDepositId("0xabc")).not.toThrow();
  });

  it("clearRecentDepositIds() is a no-op on server", () => {
    expect(() => clearRecentDepositIds()).not.toThrow();
  });
});
