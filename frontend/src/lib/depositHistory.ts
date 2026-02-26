const STORAGE_KEY = "greenreserve.recentDepositIds";

function safeParse(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === "string");
  } catch {
    return [];
  }
}

export function getRecentDepositIds(): string[] {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function addRecentDepositId(depositId: string) {
  if (typeof window === "undefined") return;

  const trimmed = depositId.trim();
  if (!trimmed) return;

  const existing = getRecentDepositIds();
  const deduped = [trimmed, ...existing.filter((x) => x !== trimmed)].slice(
    0,
    10,
  );

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
}

export function clearRecentDepositIds() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
