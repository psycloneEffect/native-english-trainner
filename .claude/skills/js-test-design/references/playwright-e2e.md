# Playwright end-to-end tests

Playwright is a dependency, so read this only if the owner has adopted it. Name files `e2e/<name>.spec.mjs`.

Keep this suite small. Cover the journeys that would hurt most if they broke, and leave the detailed logic to `node:test`.

## Rules

- **Locate elements as users do.** Prefer `getByRole`, then `getByLabel` and `getByText`. Use `getByTestId` only when nothing better exists. Avoid CSS and XPath selectors.
- **Use assertions that retry.** `await expect(locator).toBeVisible()` waits for the condition.
- **Do not use fixed waits.** `page.waitForTimeout` causes both flakiness and slowness.
- **Isolate each test.** Create its own data, and do not depend on another test having run.
- **Stub the API.** A real `/api/generate` call costs money and spends quota, so always use `page.route`.

## Example

```js
import { expect, test } from "@playwright/test";

test("生成に失敗するとエラーを表示する", async ({ page }) => {
  await page.route("**/api/generate", async (route) => {
    await route.fulfill({ status: 429, json: { error: "quota_exceeded" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "生成" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
});
```

Check the button name and the error element against `public/app.js`, because this example is not tied to the current markup.
