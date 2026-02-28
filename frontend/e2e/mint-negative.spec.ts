import { expect, test } from "@playwright/test";

test("mint page requires wallet connection", async ({ page }) => {
  await page.goto("/mint");

  await page
    .getByPlaceholder("0x…", { exact: true })
    .fill("0x000000000000000000000000000000000000dEaD");
  await page.getByPlaceholder("100").fill("1");

  await page.getByRole("button", { name: "Preview / Track status" }).click();
  await expect(
    page.getByText("Connect your wallet to continue."),
  ).toBeVisible();
});

test("deposit detail shows invalid depositId message", async ({ page }) => {
  await page.goto("/deposit/not-a-bytes32");
  await expect(page.getByText("Invalid depositId in URL.")).toBeVisible();
});
