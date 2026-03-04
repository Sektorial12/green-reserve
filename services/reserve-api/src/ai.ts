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

const stripCdata = (text: string): string => {
  return text.replace(/^\s*<!\[CDATA\[(.*)\]\]>\s*$/s, "$1")
}

const cleanText = (text: string): string => {
  return stripCdata(text).replace(/\s+/g, " ").trim()
}

export type RiskMemo = {
  riskScore: number
  confidence: number
  decision: "approve" | "manual_review" | "reject"
  reasons: string[]
}

export type ExternalRssItem = {
  title: string
  link: string
  published: string
}

export type ExternalSignals = {
  rssUrl: string
  rssSha256: string
  rssItems: ExternalRssItem[]
}

export type GenerateRiskMemoResult = {
  model: string
  promptVersion: string
  inputSha256: string
  memo: RiskMemo
  memoSha256: string
  external: ExternalSignals | null
  createdAtMs: number
}

type CacheEntry = {
  createdAtMs: number
  result: GenerateRiskMemoResult
}

type ExternalCacheEntry = {
  createdAtMs: number
  value: ExternalSignals | null
}

const externalCache = new Map<string, ExternalCacheEntry>()
const externalInFlight = new Map<string, Promise<ExternalSignals | null>>()

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

const parseRssItems = (xml: string, maxItems: number): ExternalRssItem[] => {
  const out: ExternalRssItem[] = []
  const itemBlocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []
  for (const block of itemBlocks) {
    if (out.length >= maxItems) break

    const title = cleanText((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").toString())
    let link = cleanText((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "").toString())
    const pub = cleanText((block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "").toString())

    if (!link) {
      link = cleanText((block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ?? "").toString())
    }

    if (!title || !link) continue
    out.push({ title, link, published: pub })
  }

  if (out.length) return out

  const entryBlocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []
  for (const block of entryBlocks) {
    if (out.length >= maxItems) break
    const title = cleanText((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").toString())
    const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/>/i)?.[1] ?? ""
    const link = cleanText(href)
    const pub = cleanText((block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1] ?? "").toString())
    if (!title || !link) continue
    out.push({ title, link, published: pub })
  }

  return out
}

const loadExternalSignals = async (): Promise<ExternalSignals | null> => {
  const rssUrl = (Bun.env.AI_RISK_MEMO_RSS_URL ?? "").trim()
  if (!rssUrl) return null

  const ttlSec = Number.parseInt(Bun.env.AI_EXTERNAL_CACHE_TTL_SEC ?? "3600", 10)
  const ttlMs = Number.isFinite(ttlSec) ? ttlSec * 1000 : 3600 * 1000
  const cached = externalCache.get(rssUrl)
  if (cached && Date.now() - cached.createdAtMs < ttlMs) return cached.value

  const existing = externalInFlight.get(rssUrl)
  if (existing) return await existing

  const timeoutMs = Number.parseInt(Bun.env.AI_EXTERNAL_FETCH_TIMEOUT_MS ?? "10000", 10)
  const maxItems = Number.parseInt(Bun.env.AI_RISK_MEMO_RSS_MAX_ITEMS ?? "5", 10)

  const promise = (async () => {
    let value: ExternalSignals | null = null
    try {
      const resp = await fetchWithTimeout(rssUrl, Number.isFinite(timeoutMs) ? timeoutMs : 10000)
      if (!resp.ok) {
        externalCache.set(rssUrl, { createdAtMs: Date.now(), value: null })
        return null
      }

      const text = await resp.text()
      const rssSha256 = await sha256Hex(text)
      const rssItems = parseRssItems(text, Number.isFinite(maxItems) ? maxItems : 5)
      value = { rssUrl, rssSha256, rssItems }
    } catch {
      value = null
    }

    externalCache.set(rssUrl, { createdAtMs: Date.now(), value })
    return value
  })()

  externalInFlight.set(rssUrl, promise)
  try {
    return await promise
  } finally {
    externalInFlight.delete(rssUrl)
  }
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<GenerateRiskMemoResult>>()

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

export const generateRiskMemo = async (input: unknown): Promise<GenerateRiskMemoResult> => {
  const apiKey = Bun.env.GEMINI_API_KEY
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY")

  const model = Bun.env.GEMINI_MODEL ?? "gemini-1.5-pro"
  const promptVersion = Bun.env.AI_RISK_MEMO_PROMPT_VERSION ?? "risk_memo_v1"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const external = await loadExternalSignals()
  const baseInput = input && typeof input === "object" ? (input as any) : { input }
  const effectiveInput = {
    ...baseInput,
    promptVersion,
    external,
  }

  const inputJson = JSON.stringify(effectiveInput)
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
      promptVersion,
      inputSha256,
      memo,
      memoSha256,
      external,
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
