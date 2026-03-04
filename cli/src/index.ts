import { Command } from "commander"
import path from "node:path"
import { loadDotEnv, repoRoot } from "./util"
import { runDoctor } from "./doctor"
import { runDepositCreate, runDepositStatus, runDepositSubmit } from "./deposit"

const main = async () => {
  await loadDotEnv(path.join(repoRoot, ".env"))

  const runJsonSafe = async (json: boolean, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      if (json) {
        const msg = String((e as Error)?.message ?? e)
        process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n")
        process.exit(1)
      }
      throw e
    }
  }

  const program = new Command()
  program.name("greenreserve")

  program
    .command("doctor")
    .option("--json")
    .option("--config-file <path>")
    .option("--reserve-api-base-url <url>")
    .option("--sepolia-rpc <url>")
    .option("--base-rpc <url>")
    .option("--cre-path <path>")
    .action(async (opts) => {
      await runJsonSafe(Boolean(opts.json), async () => {
        await runDoctor(opts)
      })
    })

  const deposit = program.command("deposit")

  deposit
    .command("create")
    .option("--json")
    .option("--config-file <path>")
    .option("--reserve-api-base-url <url>")
    .option("--cre-path <path>")
    .option("--non-interactive")
    .option("--to <address>")
    .option("--amount-eth <eth>")
    .option("--chain <name>")
    .option("--custodian <name>")
    .option("--custodian-private-key <hex>")
    .action(async (opts) => {
      await runJsonSafe(Boolean(opts.json), async () => {
        await runDepositCreate({
          json: Boolean(opts.json),
          configFile: opts.configFile,
          reserveApiBaseUrl: opts.reserveApiBaseUrl,
          nonInteractive: Boolean(opts.nonInteractive),
          crePath: opts.crePath,
          to: opts.to,
          amountEth: opts.amountEth,
          chain: opts.chain,
          custodian: opts.custodian,
          custodianPrivateKey: opts.custodianPrivateKey,
        })
      })
    })

  deposit
    .command("submit")
    .requiredOption("--deposit-id <bytes32>")
    .option("--json")
    .option("--scenario <healthy|unhealthy>")
    .option("--target <cre-target>")
    .option("--trigger-index <n>")
    .option("--payload-file <path>")
    .option("--cre-path <path>")
    .action(async (opts) => {
      await runJsonSafe(Boolean(opts.json), async () => {
        await runDepositSubmit({
          json: Boolean(opts.json),
          depositId: opts.depositId,
          scenario: opts.scenario,
          target: opts.target,
          triggerIndex: opts.triggerIndex ? Number.parseInt(opts.triggerIndex, 10) : 0,
          payloadFile: opts.payloadFile,
          crePath: opts.crePath,
        })
      })
    })

  deposit
    .command("status")
    .requiredOption("--deposit-id <bytes32>")
    .option("--json")
    .option("--config-file <path>")
    .option("--reserve-api-base-url <url>")
    .option("--sepolia-rpc <url>")
    .option("--base-rpc <url>")
    .option("--watch")
    .option("--interval-sec <n>")
    .action(async (opts) => {
      await runJsonSafe(Boolean(opts.json), async () => {
        await runDepositStatus({
          json: Boolean(opts.json),
          configFile: opts.configFile,
          reserveApiBaseUrl: opts.reserveApiBaseUrl,
          depositId: opts.depositId,
          sepoliaRpc: opts.sepoliaRpc,
          baseRpc: opts.baseRpc,
          watch: Boolean(opts.watch),
          intervalSec: opts.intervalSec ? Number.parseInt(opts.intervalSec, 10) : undefined,
        })
      })
    })

  await program.parseAsync(process.argv)
}

main().catch((e) => {
  process.stderr.write(String((e as Error).message ?? e) + "\n")
  process.exit(1)
})
