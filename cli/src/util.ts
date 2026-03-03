import path from "node:path"

export const repoRoot = path.resolve(import.meta.dir, "../..")

export const loadDotEnv = async (filePath: string) => {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return
  const text = await file.text()
  for (const lineRaw of text.split("\n")) {
    const line = lineRaw.trim()
    if (!line) continue
    if (line.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (!key) continue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export const requireEnv = (name: string): string => {
  const v = process.env[name]
  if (!v) throw new Error(`missing_${name}`)
  return v
}

export const asUrlBase = (raw: string): string => raw.replace(/\/+$/, "")

export const isHexAddress = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a)

export const isHexBytes32 = (s: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(s)

export const lower = (s: string) => s.toLowerCase()

export const fmtBool = (v: unknown) => (v === true ? "true" : v === false ? "false" : String(v))

export const httpGetJson = async <T>(url: string): Promise<T> => {
  const resp = await fetch(url, { headers: { accept: "application/json" } })
  if (!resp.ok) throw new Error(`http_error status=${resp.status} url=${url}`)
  return (await resp.json()) as T
}

export const httpPostJson = async <T>(url: string, body: unknown): Promise<T> => {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`http_error status=${resp.status} url=${url} body=${text.slice(0, 300)}`)
  }
  return (await resp.json()) as T
}
