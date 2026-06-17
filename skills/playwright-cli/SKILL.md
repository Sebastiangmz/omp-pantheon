---
name: playwright-cli
description: MUST USE for any browser-related tasks via the playwright CLI — verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions from the shell.
---

# playwright-cli

Browser automation through the `playwright` (or `npx playwright`) CLI rather than an in-process MCP. Use when:
- The project already ships a Playwright config and you should reuse it.
- You need to run a recorded test (`playwright test`) for regression.
- Reproducing a bug requires running CI's exact browser setup.

## Quick start

```bash
# Install browsers (one-time per machine)
npx playwright install --with-deps

# Run all tests in the project
npx playwright test

# Run a single test file
npx playwright test tests/auth.spec.ts

# Run with UI mode (debugging)
npx playwright test --ui

# Run only failed tests from last run
npx playwright test --last-failed

# Headed mode (see the browser)
npx playwright test --headed

# Generate test code by recording a session
npx playwright codegen https://example.com

# Open the test report
npx playwright show-report
```

## Decision rules

| Need | Tool |
|---|---|
| One-off browser automation in this session | `puppeteer` tool / `playwright` skill |
| Reproduce CI behavior locally | `playwright-cli` (this skill) |
| Add a new regression test | `playwright-cli` — write it as a `*.spec.ts`, commit it |
| Quick visual check | `puppeteer` tool's `screenshot` |

## Writing a test (template)

```ts
import { test, expect } from "@playwright/test";

test("user can sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("user@example.com");
  await page.getByLabel("Password").fill("hunter2");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Welcome back")).toBeVisible();
});
```

## Anti-patterns

- ❌ `page.click('.btn-primary')` — use `getByRole` / `getByLabel` / `getByText`
- ❌ Hardcoded `waitForTimeout(2000)` — use `expect(...).toBeVisible()` or `waitForResponse`
- ❌ `page.evaluate(() => …)` for things `getBy*` could do — keeps tests in browser-land

> iter-1 stub. Iter-2 will expand with auth strategies, fixtures, and parallelism tuning.
