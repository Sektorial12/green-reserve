import { expect, test } from "@playwright/test";

test("home renders and loads reserves", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Testnet demo" }),
  ).toBeVisible();

  await expect(page.getByText("Reserve API:")).toBeVisible();
  await expect(page.getByText("/e2e")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Reserves" })).toBeVisible();
  await expect(page.getByText("Reserve ratio")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("100.00%")).toBeVisible();
});
