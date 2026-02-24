const json = (value: unknown, init?: ResponseInit) => {
  return new Response(JSON.stringify(value), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  })
}

const isHexAddress = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a)

const normalizeAddress = (a: string): string => a.toLowerCase()

const shouldAllowAddress = (address: string): { isAllowed: boolean; reason: string } => {
  if (!isHexAddress(address)) return { isAllowed: false, reason: "invalid_address" }

  const n = parseInt(address.slice(-1), 16)
  if (!Number.isFinite(n)) return { isAllowed: false, reason: "invalid_address" }

  const isAllowed = n % 2 === 0
  return { isAllowed, reason: isAllowed ? "allowlisted" : "blocked_by_policy" }
}

const reserveStateForScenario = (scenario: string | null) => {
  const normalized = (scenario ?? "healthy").toLowerCase()

  const totalReservesUsd = 1_000_000
  const totalLiabilitiesUsd = normalized === "unhealthy" ? 1_100_000 : 900_000
  const reserveRatioBps = Math.floor((totalReservesUsd * 10_000) / totalLiabilitiesUsd)

  const asOfTimestamp = Number.parseInt(Bun.env.RESERVES_ASOF_TIMESTAMP ?? "1700000000", 10)

  return {
    asOfTimestamp,
    scenario: normalized,
    totalReservesUsd: String(totalReservesUsd),
    totalLiabilitiesUsd: String(totalLiabilitiesUsd),
    reserveRatioBps: String(reserveRatioBps),
    proofRef: "mock:greenreserve:v1",
  }
}

const depositIdFor = async (payload: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes)
  const hash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `0x${hash}`
}

const seenDeposits = new Map<string, any>()

Bun.serve({
  port: Number(Bun.env.PORT ?? 8788),
  fetch: async (req) => {
    const url = new URL(req.url)

    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true })
    }

    if (req.method === "GET" && url.pathname === "/reserves") {
      return json(reserveStateForScenario(url.searchParams.get("scenario")))
    }

    if (req.method === "GET" && url.pathname === "/policy/kyc") {
      const address = url.searchParams.get("address") ?? ""
      const normalized = normalizeAddress(address)
      const decision = shouldAllowAddress(normalized)
      return json({ address: normalized, ...decision })
    }

    if (req.method === "POST" && url.pathname === "/deposits") {
      let body: any = null
      try {
        body = await req.json()
      } catch {
        return json({ error: "invalid_json" }, { status: 400 })
      }

      const id = await depositIdFor(body)
      if (!seenDeposits.has(id)) seenDeposits.set(id, body)
      return json({ depositId: id })
    }

    return json({ error: "not_found" }, { status: 404 })
  },
})
