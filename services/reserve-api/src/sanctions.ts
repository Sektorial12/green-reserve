const ofacDefaultUrl = "https://www.treasury.gov/ofac/downloads/sanctions/1.0/sdn_advanced.xml"
const euDefaultUrl = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
const ukDefaultUrl = "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml"

type ListId = "ofac_sdn_advanced" | "eu_consolidated" | "uk_sanctions_list"

type SanctionsListCache = {
  fetchedAtMs: number
  sourceUrl: string
  sha256: string
  etag: string | null
  lastModified: string | null
  addresses: Set<string>
}

type SanctionsListState = {
  cache: SanctionsListCache | null
  inFlight: Promise<void> | null
  lastError: string | null
  lastAttemptedAtMs: number | null
  lastLoadedAtMs: number | null
  enableEnv?: string
  urlEnv: string
  pathEnv: string
  defaultUrl?: string
}

const lists: Record<ListId, SanctionsListState> = {
  ofac_sdn_advanced: {
    cache: null,
    inFlight: null,
    lastError: null,
    lastAttemptedAtMs: null,
    lastLoadedAtMs: null,
    urlEnv: "OFAC_SDN_ADVANCED_URL",
    pathEnv: "OFAC_SDN_ADVANCED_PATH",
    defaultUrl: ofacDefaultUrl,
  },
  eu_consolidated: {
    cache: null,
    inFlight: null,
    lastError: null,
    lastAttemptedAtMs: null,
    lastLoadedAtMs: null,
    enableEnv: "EU_SANCTIONS_ENABLE",
    urlEnv: "EU_SANCTIONS_URL",
    pathEnv: "EU_SANCTIONS_PATH",
    defaultUrl: euDefaultUrl,
  },
  uk_sanctions_list: {
    cache: null,
    inFlight: null,
    lastError: null,
    lastAttemptedAtMs: null,
    lastLoadedAtMs: null,
    enableEnv: "UK_SANCTIONS_ENABLE",
    urlEnv: "UK_SANCTIONS_URL",
    pathEnv: "UK_SANCTIONS_PATH",
    defaultUrl: ukDefaultUrl,
  },
}

let refreshInterval: ReturnType<typeof setInterval> | null = null

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

const isTruthy = (raw: string): boolean => {
  const v = raw.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "y"
}

const isEnabled = (id: ListId): boolean => {
  if (id === "ofac_sdn_advanced") return true
  const st = lists[id]
  const p = (Bun.env[st.pathEnv] ?? "").trim()
  const u = (Bun.env[st.urlEnv] ?? "").trim()
  const enabledByFlag = st.enableEnv ? isTruthy(String(Bun.env[st.enableEnv] ?? "")) : false
  return Boolean(p || u || enabledByFlag)
}

const ensureListLoaded = async (id: ListId): Promise<void> => {
  const st = lists[id]
  const ttlSec = Number.parseInt(Bun.env.SANCTIONS_CACHE_TTL_SEC ?? "3600", 10)
  const ttlMs = Number.isFinite(ttlSec) ? ttlSec * 1000 : 3600 * 1000

  if (st.cache && Date.now() - st.cache.fetchedAtMs < ttlMs) return

  if (st.inFlight) {
    await st.inFlight
    return
  }

  st.inFlight = (async () => {
    st.lastAttemptedAtMs = Date.now()
    const sourcePath = (Bun.env[st.pathEnv] ?? "").trim()
    if (sourcePath) {
      const file = Bun.file(sourcePath)
      if (!(await file.exists())) {
        throw new Error(`sanctions_file_not_found list=${id} path=${sourcePath}`)
      }
      const text = await file.text()
      const sha256 = await sha256Hex(text)
      const addresses = extractEvmAddresses(text)
      st.cache = {
        fetchedAtMs: Date.now(),
        sourceUrl: `file://${sourcePath}`,
        sha256,
        etag: null,
        lastModified: null,
        addresses,
      }
      st.lastLoadedAtMs = st.cache.fetchedAtMs
      st.lastError = null
      return
    }

    const sourceUrl = ((Bun.env[st.urlEnv] ?? "").trim() || st.defaultUrl || "").trim()
    if (!sourceUrl) {
      throw new Error(`sanctions_source_not_configured list=${id}`)
    }

    const timeoutMs = Number.parseInt(Bun.env.SANCTIONS_FETCH_TIMEOUT_MS ?? "60000", 10)
    const controller = new AbortController()

    const timeoutMsSafe = Number.isFinite(timeoutMs) ? timeoutMs : 60000
    const fetchPromise = fetch(sourceUrl, {
      headers: {
        accept: "application/xml,text/xml,text/csv,application/json,text/plain,*/*",
        ...(st.cache?.etag ? { "if-none-match": st.cache.etag } : {}),
        ...(st.cache?.lastModified ? { "if-modified-since": st.cache.lastModified } : {}),
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
          reject(new Error(`sanctions_fetch_timeout list=${id} url=${sourceUrl} timeoutMs=${timeoutMsSafe}`))
        }, timeoutMsSafe),
      ),
    ])) as Response

    if (resp.status === 304 && st.cache) {
      st.cache = { ...st.cache, fetchedAtMs: Date.now() }
      return
    }

    if (!resp.ok) {
      throw new Error(`sanctions_fetch_failed list=${id} url=${sourceUrl} status=${resp.status}`)
    }

    const text = await resp.text()
    const sha256 = await sha256Hex(text)
    const addresses = extractEvmAddresses(text)

    const etag = resp.headers.get("etag")
    const lastModified = resp.headers.get("last-modified")

    st.cache = {
      fetchedAtMs: Date.now(),
      sourceUrl,
      sha256,
      etag,
      lastModified,
      addresses,
    }
    st.lastLoadedAtMs = st.cache.fetchedAtMs
    st.lastError = null
  })().finally(() => {
    st.inFlight = null
  })

  try {
    await st.inFlight
  } catch (e) {
    st.lastError = (e as Error).message
    throw e
  }
}

export const ensureSanctionsLoaded = async (): Promise<void> => {
  const enabled: ListId[] = ["ofac_sdn_advanced"]
  if (isEnabled("eu_consolidated")) enabled.push("eu_consolidated")
  if (isEnabled("uk_sanctions_list")) enabled.push("uk_sanctions_list")

  await Promise.all(enabled.map((id) => ensureListLoaded(id)))
}

export const startSanctionsRefreshLoop = (): void => {
  if (refreshInterval) return

  const intervalSecRaw = (Bun.env.SANCTIONS_REFRESH_INTERVAL_SEC ?? "300").trim()
  const intervalSec = Number.parseInt(intervalSecRaw, 10)
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return

  const tick = async () => {
    try {
      await ensureSanctionsLoaded()
    } catch {
      return
    }
  }

  tick().catch(() => {})
  refreshInterval = setInterval(() => {
    tick().catch(() => {})
  }, intervalSec * 1000)
}

export const getSanctionsLoadState = () => {
  return {
    lists: {
      ofac_sdn_advanced: {
        enabled: isEnabled("ofac_sdn_advanced"),
        loaded: Boolean(lists.ofac_sdn_advanced.cache),
        inFlight: Boolean(lists.ofac_sdn_advanced.inFlight),
        lastError: lists.ofac_sdn_advanced.lastError,
        lastAttemptedAtMs: lists.ofac_sdn_advanced.lastAttemptedAtMs,
        lastLoadedAtMs: lists.ofac_sdn_advanced.lastLoadedAtMs,
      },
      eu_consolidated: {
        enabled: isEnabled("eu_consolidated"),
        loaded: Boolean(lists.eu_consolidated.cache),
        inFlight: Boolean(lists.eu_consolidated.inFlight),
        lastError: lists.eu_consolidated.lastError,
        lastAttemptedAtMs: lists.eu_consolidated.lastAttemptedAtMs,
        lastLoadedAtMs: lists.eu_consolidated.lastLoadedAtMs,
      },
      uk_sanctions_list: {
        enabled: isEnabled("uk_sanctions_list"),
        loaded: Boolean(lists.uk_sanctions_list.cache),
        inFlight: Boolean(lists.uk_sanctions_list.inFlight),
        lastError: lists.uk_sanctions_list.lastError,
        lastAttemptedAtMs: lists.uk_sanctions_list.lastAttemptedAtMs,
        lastLoadedAtMs: lists.uk_sanctions_list.lastLoadedAtMs,
      },
    },
  }
}

export const getSanctionsMeta = () => {
  const out: Record<string, any> = {}

  const listIds: ListId[] = ["ofac_sdn_advanced", "eu_consolidated", "uk_sanctions_list"]

  for (const id of listIds) {
    if (!isEnabled(id)) continue
    if (!lists[id].cache) return null
  }

  for (const id of listIds) {
    const st = lists[id]
    if (!st.cache) continue
    out[id] = {
      sourceUrl: st.cache.sourceUrl,
      sha256: st.cache.sha256,
      etag: st.cache.etag,
      lastModified: st.cache.lastModified,
      loadedAtMs: st.lastLoadedAtMs,
      blockedAddressCount: st.cache.addresses.size,
    }
  }

  if (Object.keys(out).length === 0) return null

  return {
    lists: out,
  }
}

export const screenAddressAgainstSanctions = (
  address: string,
): { isAllowed: boolean; reason: string; ruleId: string; checkedAt?: string; listVersion?: string; evidence?: any } => {
  const normalized = address.toLowerCase()

  const meta = getSanctionsMeta()
  if (!meta) {
    return {
      isAllowed: false,
      reason: "sanctions_not_loaded",
      ruleId: "SANCTIONS:NOT_LOADED",
    }
  }

  const listIds: ListId[] = ["ofac_sdn_advanced", "eu_consolidated", "uk_sanctions_list"]
  const enabledListIds = listIds.filter((id) => isEnabled(id))
  const listVersion = enabledListIds
    .map((id) => `${id}:${String((meta as any)?.lists?.[id]?.sha256 ?? "")}`)
    .join("|")
  const checkedAtMs = enabledListIds
    .map((id) => lists[id].lastLoadedAtMs)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    .reduce((acc, v) => (acc === null ? v : Math.min(acc, v)), null as null | number)
  const checkedAt = checkedAtMs ? new Date(checkedAtMs).toISOString() : undefined
  for (const id of listIds) {
    const st = lists[id]
    if (!st.cache) continue
    if (st.cache.addresses.has(normalized)) {
      return {
        isAllowed: false,
        reason: `sanctions_${id}_match`,
        ruleId: `SANCTIONS:${id}:ADDRESS_MATCH`,
        checkedAt,
        listVersion,
        evidence: {
          sourceUrl: st.cache.sourceUrl,
          sha256: st.cache.sha256,
          etag: st.cache.etag,
          lastModified: st.cache.lastModified,
          lists: meta.lists,
          matchedList: id,
        },
      }
    }
  }

  const primaryList: ListId | null = ((): ListId | null => {
    if (lists.ofac_sdn_advanced.cache) return "ofac_sdn_advanced"
    for (const id of listIds) if (lists[id].cache) return id
    return null
  })()

  return {
    isAllowed: true,
    reason: "sanctions_clear",
    ruleId: "SANCTIONS:CLEAR",
    checkedAt,
    listVersion,
    evidence: {
      ...(primaryList && lists[primaryList].cache
        ? {
            sourceUrl: lists[primaryList].cache!.sourceUrl,
            sha256: lists[primaryList].cache!.sha256,
            etag: lists[primaryList].cache!.etag,
            lastModified: lists[primaryList].cache!.lastModified,
            primaryList,
          }
        : {}),
      lists: meta.lists,
    },
  }
}
