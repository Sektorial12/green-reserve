import { env } from "@/lib/env";

export type ReserveState = {
  asOfTimestamp: number;
  scenario: string;
  totalReservesUsd: string;
  totalLiabilitiesUsd: string;
  reserveRatioBps: string;
  proofRef: string;
};

export type PolicyKycDecision = {
  address: string;
  isAllowed: boolean;
  reason: string;
};

type RetryOptions = {
  timeoutMs?: number;
  maxRetries?: number;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  options?: RetryOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const maxRetries = options?.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok) return res.json();

      const shouldRetry =
        res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (!shouldRetry || attempt === maxRetries) {
        throw new Error(`Request failed: ${res.status}`);
      }

      await sleep(Math.min(30_000, 1_000 * 2 ** (attempt + 1)));
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (!isAbort || attempt === maxRetries) throw err;
      await sleep(Math.min(30_000, 1_000 * 2 ** (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Unexpected retry loop exit");
}

export const reserveApi = {
  async health(): Promise<{ ok: boolean }> {
    return fetchJsonWithRetry<{ ok: boolean }>(
      `${env.NEXT_PUBLIC_RESERVE_API_BASE_URL}/health`,
      { method: "GET" },
      { maxRetries: 1 },
    );
  },

  async reserves(scenario?: string): Promise<ReserveState> {
    const url = new URL(`${env.NEXT_PUBLIC_RESERVE_API_BASE_URL}/reserves`);
    if (scenario) url.searchParams.set("scenario", scenario);

    return fetchJsonWithRetry<ReserveState>(url.toString(), { method: "GET" });
  },

  async policyKyc(address: string): Promise<PolicyKycDecision> {
    const url = new URL(`${env.NEXT_PUBLIC_RESERVE_API_BASE_URL}/policy/kyc`);
    url.searchParams.set("address", address);

    return fetchJsonWithRetry<PolicyKycDecision>(url.toString(), {
      method: "GET",
    });
  },
};
