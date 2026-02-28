import { expect, test } from "@playwright/test";

function depositIdEndingWith(hexLastChar: string) {
  return `0x${"0".repeat(63)}${hexLastChar}`;
}

function isBytes32Hex(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function depositIdFromPageUrl(url: string) {
  const pathname = new URL(url).pathname;
  const idx = pathname.indexOf("/deposit/");
  if (idx === -1) return "";
  return decodeURIComponent(pathname.slice(idx + "/deposit/".length));
}

async function assertValidDepositPage(pageUrl: string, browserHref: string) {
  const depositIdInUrl = depositIdFromPageUrl(pageUrl);
  expect(
    isBytes32Hex(depositIdInUrl),
    [
      "depositId in URL is invalid",
      `page.url()=${JSON.stringify(pageUrl)}`,
      `window.location.href=${JSON.stringify(browserHref)}`,
      `depositId=${JSON.stringify(depositIdInUrl)}`,
      `len=${depositIdInUrl.length}`,
    ].join("\n"),
  ).toBeTruthy();
}

test("critical journey: connect wallet → submit → track status", async ({
  page,
}) => {
  const depositId = depositIdEndingWith("0");

  await page.goto("/mint");

  await page.getByRole("button", { name: "Connect wallet" }).click();

  await page
    .getByPlaceholder("0x…", { exact: true })
    .fill("0x000000000000000000000000000000000000dEaD");
  await page.getByPlaceholder("100").fill("100");
  await page.getByPlaceholder("0x… (bytes32)").fill(depositId);
  await expect(page.getByPlaceholder("0x… (bytes32)")).toHaveValue(depositId);

  await page.getByRole("button", { name: "Preview / Track status" }).click();
  await page.waitForURL(/\/deposit\//);
  const pageUrl = page.url();
  const browserHref = await page.evaluate(() => window.location.href);
  await assertValidDepositPage(pageUrl, browserHref);
  await expect(page.getByText("Invalid depositId in URL.")).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Deposit status" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("reserveRatioBps=10000")).toBeVisible();
  await expect(page.getByText("allowed")).toBeVisible();
});

test("negative: insufficient reserves blocks mint stage", async ({ page }) => {
  const depositId = depositIdEndingWith("1");

  await page.goto("/mint");
  await page.getByRole("button", { name: "Connect wallet" }).click();

  await page
    .getByPlaceholder("0x…", { exact: true })
    .fill("0x000000000000000000000000000000000000dEaD");
  await page.getByPlaceholder("100").fill("100");
  await page.getByPlaceholder("0x… (bytes32)").fill(depositId);
  await expect(page.getByPlaceholder("0x… (bytes32)")).toHaveValue(depositId);

  await page.getByRole("button", { name: "Preview / Track status" }).click();
  await page.waitForURL(/\/deposit\//);
  const pageUrl = page.url();
  const browserHref = await page.evaluate(() => window.location.href);
  await assertValidDepositPage(pageUrl, browserHref);
  await expect(page.getByText("Invalid depositId in URL.")).toHaveCount(0);

  await expect(page.getByText("reserveRatioBps=9000")).toBeVisible();
  await expect(page.getByText("Blocked by failed checks")).toBeVisible();
});

test("negative: policy blocked blocks mint stage", async ({ page }) => {
  const depositId = depositIdEndingWith("2");

  await page.goto("/mint");
  await page.getByRole("button", { name: "Connect wallet" }).click();

  await page
    .getByPlaceholder("0x…", { exact: true })
    .fill("0x000000000000000000000000000000000000dEaD");
  await page.getByPlaceholder("100").fill("100");
  await page.getByPlaceholder("0x… (bytes32)").fill(depositId);
  await expect(page.getByPlaceholder("0x… (bytes32)")).toHaveValue(depositId);

  await page.getByRole("button", { name: "Preview / Track status" }).click();
  await page.waitForURL(/\/deposit\//);
  const pageUrl = page.url();
  const browserHref = await page.evaluate(() => window.location.href);
  await assertValidDepositPage(pageUrl, browserHref);
  await expect(page.getByText("Invalid depositId in URL.")).toHaveCount(0);

  await expect(page.getByText("blocked", { exact: true })).toBeVisible();
  await expect(page.getByText("Blocked by failed checks")).toBeVisible();
});
