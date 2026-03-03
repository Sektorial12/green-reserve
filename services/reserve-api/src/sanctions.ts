const defaultUrl = "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml"

type SanctionsCache = {
  fetchedAtMs: number
  sourceUrl: string
  sha256: string
  etag: string | null
  lastModified: string | null
  addresses: Set<string>
}

let cache: SanctionsCache | null = null

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

const extractEvmAddresses = (xmlText: string): Set<string> => {
  const re = /0x[0-9a-fA-F]{40}/g
  const out = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(xmlText)) !== null) {
    out.add(m[0].toLowerCase())
  }
  return out
}

export const ensureSanctionsLoaded = async (): Promise<void> => {
  const ttlSec = Number.parseInt(Bun.env.SANCTIONS_CACHE_TTL_SEC ?? "3600", 10)
  const ttlMs = Number.isFinite(ttlSec) ? ttlSec * 1000 : 3600 * 1000

  if (cache && Date.now() - cache.fetchedAtMs < ttlMs) return

  const sourceUrl = Bun.env.OFAC_SDN_ADVANCED_URL ?? defaultUrl
  const resp = await fetch(sourceUrl, {
    headers: {
      "accept": "application/xml,text/xml,*/*",
      ...(cache?.etag ? { "if-none-match": cache.etag } : {}),
      ...(cache?.lastModified ? { "if-modified-since": cache.lastModified } : {}),
    },
  })

  if (resp.status === 304 && cache) {
    cache = { ...cache, fetchedAtMs: Date.now() }
    return
  }

  if (!resp.ok) {
    throw new Error(`sanctions_fetch_failed url=${sourceUrl} status=${resp.status}`)
  }

  const xmlText = await resp.text()
  const sha256 = await sha256Hex(xmlText)
  const addresses = extractEvmAddresses(xmlText)

  const etag = resp.headers.get("etag")
  const lastModified = resp.headers.get("last-modified")

  cache = {
    fetchedAtMs: Date.now(),
    sourceUrl,
    sha256,
    etag,
    lastModified,
    addresses,
  }
}

export const getSanctionsMeta = () => {
  if (!cache) return null
  return {
    sourceUrl: cache.sourceUrl,
    sha256: cache.sha256,
    etag: cache.etag,
    lastModified: cache.lastModified,
    blockedAddressCount: cache.addresses.size,
  }
}

export const screenAddressAgainstSanctions = (address: string): { isAllowed: boolean; reason: string; evidence?: any } => {
  const normalized = address.toLowerCase()

  if (!cache) {
    return {
      isAllowed: false,
      reason: "sanctions_not_loaded",
    }
  }

  const hit = cache.addresses.has(normalized)
  if (hit) {
    return {
      isAllowed: false,
      reason: "sanctions_ofac_sdn_match",
      evidence: {
        sourceUrl: cache.sourceUrl,
        sha256: cache.sha256,
        etag: cache.etag,
        lastModified: cache.lastModified,
      },
    }
  }

  return {
    isAllowed: true,
    reason: "sanctions_clear",
    evidence: {
      sourceUrl: cache.sourceUrl,
      sha256: cache.sha256,
      etag: cache.etag,
      lastModified: cache.lastModified,
    },
  }
}
