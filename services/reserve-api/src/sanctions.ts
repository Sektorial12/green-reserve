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
let inFlight: Promise<void> | null = null
let lastError: string | null = null
let lastAttemptedAtMs: number | null = null
let lastLoadedAtMs: number | null = null

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

  if (inFlight) {
    await inFlight
    return
  }

  inFlight = (async () => {
    lastAttemptedAtMs = Date.now()
    const sourcePath = Bun.env.OFAC_SDN_ADVANCED_PATH
    if (sourcePath) {
      const file = Bun.file(sourcePath)
      if (!(await file.exists())) {
        throw new Error(`sanctions_file_not_found path=${sourcePath}`)
      }
      const xmlText = await file.text()
      const sha256 = await sha256Hex(xmlText)
      const addresses = extractEvmAddresses(xmlText)
      cache = {
        fetchedAtMs: Date.now(),
        sourceUrl: `file://${sourcePath}`,
        sha256,
        etag: null,
        lastModified: null,
        addresses,
      }
      lastLoadedAtMs = cache.fetchedAtMs
      lastError = null
      return
    }

    const sourceUrl = Bun.env.OFAC_SDN_ADVANCED_URL ?? defaultUrl
    const timeoutMs = Number.parseInt(Bun.env.SANCTIONS_FETCH_TIMEOUT_MS ?? "20000", 10)
    const controller = new AbortController()

    const timeoutMsSafe = Number.isFinite(timeoutMs) ? timeoutMs : 20000
    const fetchPromise = fetch(sourceUrl, {
      headers: {
        accept: "application/xml,text/xml,*/*",
        ...(cache?.etag ? { "if-none-match": cache.etag } : {}),
        ...(cache?.lastModified ? { "if-modified-since": cache.lastModified } : {}),
      },
      signal: controller.signal,
    })

    const resp = (await Promise.race([
      fetchPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          try {
            controller.abort()
          } catch {
            // ignore
          }
          reject(new Error(`sanctions_fetch_timeout url=${sourceUrl} timeoutMs=${timeoutMsSafe}`))
        }, timeoutMsSafe),
      ),
    ])) as Response

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
    lastLoadedAtMs = cache.fetchedAtMs
    lastError = null
  })().finally(() => {
    inFlight = null
  })

  try {
    await inFlight
  } catch (e) {
    lastError = (e as Error).message
    throw e
  }
}

export const getSanctionsLoadState = () => {
  return {
    loaded: Boolean(cache),
    inFlight: Boolean(inFlight),
    lastError,
    lastAttemptedAtMs,
    lastLoadedAtMs,
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
