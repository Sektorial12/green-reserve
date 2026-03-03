import path from "node:path"
import { z } from "zod"
import { repoRoot } from "./util"

const configSchema = z.object({
  reserveApiBaseUrl: z.string(),
  sepoliaIssuerAddress: z.string().optional(),
  sepoliaIssuerWriteReceiverAddress: z.string().optional(),
  sepoliaSenderAddress: z.string().optional(),
  sepoliaSenderWriteReceiverAddress: z.string().optional(),
  baseSepoliaTokenBAddress: z.string().optional(),
  baseSepoliaReceiverAddress: z.string().optional(),
})

export type WorkflowConfig = z.infer<typeof configSchema>

export const defaultWorkflowConfigPath = () =>
  process.env.CONFIG_FILE ?? path.join(repoRoot, "workflows/greenreserve-workflow/config.staging.json")

export const readWorkflowConfig = async (filePath: string): Promise<WorkflowConfig> => {
  const file = Bun.file(filePath)
  if (!(await file.exists())) throw new Error(`config_not_found path=${filePath}`)
  const text = await file.text()
  const parsed = JSON.parse(text)
  return configSchema.parse(parsed)
}
