import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutableFromPath(executableName) {
  const pathEnv = process.env.PATH || "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of parts) {
    const candidate = path.join(dir, executableName);
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

async function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  try {
    const mod = await import("@playwright/test");
    const chromium = mod.chromium ?? mod.default?.chromium;
    const executablePath = chromium?.executablePath?.();
    if (
      typeof executablePath === "string" &&
      executablePath.length &&
      (await pathExists(executablePath))
    ) {
      return executablePath;
    }
  } catch {}

  const candidates = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ];

  for (const name of candidates) {
    const found = await resolveExecutableFromPath(name);
    if (found) return found;
  }

  return undefined;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not determine free port")));
        return;
      }

      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function run(cmd, args, { env, cwd, stdio = "inherit" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio,
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function runCapture(cmd, args, { env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${cmd} ${args.join(" ")} exited with code ${code}\n${stderr}`,
          ),
        );
    });
  });
}

async function waitForHttpOk(
  url,
  { timeoutMs = 60_000, intervalMs = 500 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(
          res.statusCode && res.statusCode >= 200 && res.statusCode < 500,
        );
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2_000, () => {
        req.destroy();
        resolve(false);
      });
    });

    if (ok) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timed out waiting for server: ${url}`);
}

function evaluateBudgets(lhr, budget, pagePath) {
  const page = budget.pages.find((p) => p.path === pagePath);
  if (!page) throw new Error(`No budget entry found for path: ${pagePath}`);

  const failures = [];

  if (page.categories) {
    for (const [categoryId, minScore] of Object.entries(page.categories)) {
      const score = lhr?.categories?.[categoryId]?.score;
      if (typeof score !== "number") {
        failures.push({
          type: "category",
          id: categoryId,
          message: "Missing score",
        });
        continue;
      }
      if (score < minScore) {
        failures.push({
          type: "category",
          id: categoryId,
          message: `Score ${score.toFixed(2)} < ${minScore}`,
        });
      }
    }
  }

  if (page.audits) {
    for (const [auditId, threshold] of Object.entries(page.audits)) {
      const numericValue = lhr?.audits?.[auditId]?.numericValue;
      if (typeof numericValue !== "number") {
        failures.push({
          type: "audit",
          id: auditId,
          message: "Missing numericValue",
        });
        continue;
      }

      if (
        typeof threshold?.maxNumericValue === "number" &&
        numericValue > threshold.maxNumericValue
      ) {
        failures.push({
          type: "audit",
          id: auditId,
          message: `${numericValue} > ${threshold.maxNumericValue}`,
        });
      }
    }
  }

  return failures;
}

function median(values) {
  const nums = values
    .filter((n) => typeof n === "number" && !Number.isNaN(n))
    .slice()
    .sort((a, b) => a - b);

  if (!nums.length) return undefined;

  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 1) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

function aggregateLhrsForBudget(lhrs, budget, pagePath) {
  const page = budget.pages.find((p) => p.path === pagePath);
  if (!page) throw new Error(`No budget entry found for path: ${pagePath}`);

  const categories = {};
  const audits = {};

  if (page.categories) {
    for (const categoryId of Object.keys(page.categories)) {
      const m = median(lhrs.map((lhr) => lhr?.categories?.[categoryId]?.score));
      if (typeof m === "number") categories[categoryId] = { score: m };
    }
  }

  if (page.audits) {
    for (const auditId of Object.keys(page.audits)) {
      const m = median(lhrs.map((lhr) => lhr?.audits?.[auditId]?.numericValue));
      if (typeof m === "number") audits[auditId] = { numericValue: m };
    }
  }

  return { categories, audits };
}

async function main() {
  const port = process.env.LH_PORT
    ? Number(process.env.LH_PORT)
    : await getFreePort();
  const pagePath = process.env.LH_PATH || "/";
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}${pagePath}`;

  const tmpDir = path.join(process.cwd(), ".lighthouse-tmp");
  await mkdir(tmpDir, { recursive: true });

  const chromeFlags =
    process.env.LH_CHROME_FLAGS ||
    "--headless=new --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu";

  const budget = JSON.parse(
    await readFile(
      new URL("../lighthouse/budget.json", import.meta.url),
      "utf8",
    ),
  );

  const env = {
    ...process.env,
    NODE_ENV: "production",
    E2E_TEST: "true",
    NEXT_PUBLIC_E2E_TEST: "true",
    NEXT_PUBLIC_RESERVE_API_BASE_URL: `${baseUrl}/e2e`,
    TMPDIR: tmpDir,
    TEMP: tmpDir,
    TMP: tmpDir,
  };

  const chromePath = await resolveChromePath();
  if (chromePath && !env.CHROME_PATH) env.CHROME_PATH = chromePath;

  if (!env.CHROME_PATH) {
    throw new Error(
      [
        "No Chrome/Chromium binary found for Lighthouse.",
        "Fix options:",
        "  1) Install Playwright Chromium: npx playwright install chromium",
        "  2) Install system Chromium/Chrome and/or set CHROME_PATH to the binary",
      ].join("\n"),
    );
  }

  await run("npm", ["run", "build"], { cwd: process.cwd(), env });

  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: false,
  });

  const cleanup = () => {
    if (server.killed) return;
    server.kill("SIGTERM");
    setTimeout(() => {
      if (!server.killed) server.kill("SIGKILL");
    }, 5_000).unref();
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await waitForHttpOk(url);

    const lighthouseArgs = [
      "lighthouse",
      url,
      "--output",
      "json",
      "--output-path",
      "stdout",
      "--only-categories",
      "performance,accessibility,best-practices,seo",
      `--chrome-flags=${chromeFlags}`,
    ];

    if (process.env.LH_VERBOSE) lighthouseArgs.push("--verbose");
    else lighthouseArgs.push("--quiet");

    const runs = process.env.LH_RUNS ? Number(process.env.LH_RUNS) : 3;
    const runCount = Number.isFinite(runs) && runs > 0 ? Math.floor(runs) : 1;

    const lhrs = [];
    for (let i = 0; i < runCount; i += 1) {
      let stdout;
      try {
        ({ stdout } = await runCapture("npx", lighthouseArgs, {
          cwd: process.cwd(),
          env,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Unable to connect to Chrome")) {
          throw new Error(
            [
              msg,
              "",
              "Lighthouse could not find/launch a Chrome/Chromium binary.",
              "Fix options:",
              "  1) Install Playwright Chromium: npx playwright install chromium",
              "  2) Install system Chromium/Chrome and/or set CHROME_PATH to the binary",
              "",
              `Debug: resolved CHROME_PATH=${env.CHROME_PATH || "(unset)"}`,
            ].join("\n"),
          );
        }
        throw err;
      }

      lhrs.push(JSON.parse(stdout));
    }

    const lhr =
      lhrs.length === 1 ? lhrs[0] : aggregateLhrsForBudget(lhrs, budget, pagePath);
    const failures = evaluateBudgets(lhr, budget, pagePath);

    if (failures.length) {
      for (const f of failures) {
        process.stderr.write(`${f.type}:${f.id} ${f.message}\n`);
      }
      process.exitCode = 1;
      return;
    }

    process.stdout.write("Lighthouse budgets: OK\n");
  } finally {
    cleanup();
  }
}

await main();
