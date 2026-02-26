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

export const reserveApi = {
  async health(): Promise<{ ok: boolean }> {
    const res = await fetch(`${env.NEXT_PUBLIC_RESERVE_API_BASE_URL}/health`, {
      method: "GET",
    });
    if (!res.ok) throw new Error(`Reserve API /health failed: ${res.status}`);
    return res.json();
  },

  async reserves(scenario?: string): Promise<ReserveState> {
    const url = new URL(`${env.NEXT_PUBLIC_RESERVE_API_BASE_URL}/reserves`);
    if (scenario) url.searchParams.set("scenario", scenario);

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`Reserve API /reserves failed: ${res.status}`);
    return res.json();
  },

  async policyKyc(address: string): Promise<PolicyKycDecision> {
    const url = new URL(`${env.NEXT_PUBLIC_RESERVE_API_BASE_URL}/policy/kyc`);
    url.searchParams.set("address", address);

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok)
      throw new Error(`Reserve API /policy/kyc failed: ${res.status}`);
    return res.json();
  },
};
