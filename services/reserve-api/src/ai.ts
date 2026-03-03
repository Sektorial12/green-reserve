const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

const stripCodeFences = (text: string): string => {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
}

type RiskMemo = {
  riskScore: number
  confidence: number
  decision: "approve" | "manual_review" | "reject"
  reasons: string[]
}

type CacheEntry = {
  createdAtMs: number
  result: {
    model: string
    inputSha256: string
    memo: RiskMemo
    memoSha256: string
    createdAtMs: number
  }
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<CacheEntry["result"]>>()

const parseRiskMemo = (raw: unknown): RiskMemo => {
  if (!raw || typeof raw !== "object") throw new Error("invalid_ai_json")
  const o = raw as any

  const riskScore = o.riskScore
  const confidence = o.confidence
  const decision = o.decision
  const reasons = o.reasons

  if (!Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) throw new Error("invalid_riskScore")
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("invalid_confidence")
  if (decision !== "approve" && decision !== "manual_review" && decision !== "reject") throw new Error("invalid_decision")
  if (!Array.isArray(reasons) || reasons.some((r) => typeof r !== "string")) throw new Error("invalid_reasons")

  return {
    riskScore: Math.round(riskScore),
    confidence,
    decision,
    reasons,
  }
}

export const generateRiskMemo = async (input: unknown) => {
  const apiKey = Bun.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY")

  const model = Bun.env.GEMINI_MODEL ?? "gemini-1.5-pro"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const inputJson = JSON.stringify(input)
  const inputSha256 = await sha256Hex(inputJson)

  const ttlSec = Number.parseInt(Bun.env.AI_CACHE_TTL_SEC ?? "3600", 10)
  const ttlMs = Number.isFinite(ttlSec) ? ttlSec * 1000 : 3600 * 1000
  const cached = cache.get(inputSha256)
  if (cached && Date.now() - cached.createdAtMs < ttlMs) {
    return cached.result
  }

  const existing = inFlight.get(inputSha256)
  if (existing) {
    return existing
  }

  const prompt =
    "Return ONLY valid JSON (no markdown) with keys: " +
    "riskScore (0-100 integer), confidence (0-1 number), decision (approve|manual_review|reject), reasons (string[]). " +
    "Assess compliance and operational risk for this deposit request. Input: " +
    inputJson

  const promise = (async () => {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0,
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => "")
      throw new Error(`gemini_error status=${resp.status} body=${text.slice(0, 300)}`)
    }

    const data: any = await resp.json()
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ??
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      ""

    if (!text || typeof text !== "string") throw new Error("gemini_empty_response")

    const cleaned = stripCodeFences(text)
    const parsed = JSON.parse(cleaned)
    const memo = parseRiskMemo(parsed)

    const memoCanonical = JSON.stringify(memo)
    const memoSha256 = await sha256Hex(memoCanonical)

    const result = {
      model,
      inputSha256,
      memo,
      memoSha256,
      createdAtMs: Date.now(),
    }

    cache.set(inputSha256, { createdAtMs: Date.now(), result })
    return result
  })()

  inFlight.set(inputSha256, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(inputSha256)
  }
}
