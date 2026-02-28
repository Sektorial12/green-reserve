import { describe, expect, it, vi } from "vitest";

type MockFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function mockResponse(params: {
  ok: boolean;
  status: number;
  json?: unknown;
}): MockFetchResponse {
  return {
    ok: params.ok,
    status: params.status,
    json: async () => params.json,
  };
}

describe("reserveApiClient", () => {
  it("health() hits /health", async () => {
    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL = "http://example.test";
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ ok: true, status: 200, json: { ok: true } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { reserveApi } = await import("@/services/reserveApiClient");

    await expect(reserveApi.health()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test/health");
  });

  it("reserves() includes scenario query param", async () => {
    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL = "http://example.test";
    vi.resetModules();

    const payload = {
      asOfTimestamp: 0,
      scenario: "S",
      totalReservesUsd: "1",
      totalLiabilitiesUsd: "1",
      reserveRatioBps: "10000",
      proofRef: "x",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ ok: true, status: 200, json: payload }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { reserveApi } = await import("@/services/reserveApiClient");

    await expect(reserveApi.reserves("stress")).resolves.toEqual(payload);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://example.test/reserves?scenario=stress",
    );
  });

  it("retries 5xx once for health()", async () => {
    vi.useFakeTimers();

    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL = "http://example.test";
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 503 }))
      .mockResolvedValueOnce(
        mockResponse({ ok: true, status: 200, json: { ok: true } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { reserveApi } = await import("@/services/reserveApiClient");

    const p = reserveApi.health();
    await vi.runAllTimersAsync();

    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("does not retry 4xx", async () => {
    process.env.NEXT_PUBLIC_RESERVE_API_BASE_URL = "http://example.test";
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ ok: false, status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const { reserveApi } = await import("@/services/reserveApiClient");

    await expect(reserveApi.health()).rejects.toThrow("Request failed: 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
