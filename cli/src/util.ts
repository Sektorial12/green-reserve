import { accessSync, constants as fsConstants } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const repoRoot = path.resolve(__dirname, "../..")

export const readTextFileIfExists = async (filePath: string): Promise<string | null> => {
  try {
    return await readFile(filePath, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return null
    throw e
  }
}

export const loadDotEnv = async (filePath: string) => {
  const text = await readTextFileIfExists(filePath)
  if (text === null) return
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

export const findExecutable = (name: string): string | null => {
  const raw = (name || "").trim()
  if (!raw) return null

  const candidates = path.isAbsolute(raw)
    ? [raw]
    : String(process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((dir) => path.join(dir, raw))

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return null
}

export const sanitizedChildEnv = (base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...base }
  const workflowBin = path.join(repoRoot, "workflows/greenreserve-workflow/node_modules/.bin")

  delete env.LD_LIBRARY_PATH
  delete env.LD_PRELOAD

  for (const key of Object.keys(env)) {
    if (key === "SNAP" || key.startsWith("SNAP_")) delete env[key]
  }

  const minimalPath = [workflowBin, "/snap/bin", "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"]
  env.PATH = minimalPath.join(path.delimiter)

  if (findExecutable("/snap/bun-js/current/_bun/bin/bun")) env.BUN = "/snap/bun-js/current/_bun/bin/bun"

  return env
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
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(`http_error status=${resp.status} url=${url} body=${text.slice(0, 300)}`)
  }
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
