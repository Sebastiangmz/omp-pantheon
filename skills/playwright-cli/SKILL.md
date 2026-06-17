---
name: playwright-cli
description: MUST USE for any browser-related tasks via the playwright CLI — verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions from the shell.
---

# Browser Automation via CLI

Browser automation through the `playwright` (or `npx playwright`) CLI and the `bash` tool rather than the in-process `browser` tool. Use when:
- The project already ships a Playwright config and you should reuse it.
- You need to run a recorded test (`playwright test`) for regression.
- Reproducing a bug requires running CI's exact browser setup.
- You need headless batch operations from the shell.

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

## CLI commands reference

### Navigation & interaction (via `agent-browser` or similar CLI wrapper)

```bash
# Navigate
agent-browser open <url>

# Snapshot (get interactive elements with refs)
agent-browser snapshot -i

# Interact using refs from snapshot
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser type @e2 "text"
agent-browser press Enter
agent-browser hover @e1
agent-browser select @e1 "value"
agent-browser scroll down 500
agent-browser scrollintoview @e1
agent-browser drag @e1 @e2
agent-browser upload @e1 file.pdf

# Get information
agent-browser get text @e1
agent-browser get html @e1
agent-browser get value @e1
agent-browser get attr @e1 href
agent-browser get title
agent-browser get url

# Screenshots
agent-browser screenshot path.png
agent-browser screenshot --full
agent-browser screenshot --annotate

# Wait
agent-browser wait @e1
agent-browser wait 2000
agent-browser wait --text "Success"
agent-browser wait --url "**/dashboard"
agent-browser wait --load networkidle

# State management
agent-browser state save auth.json
agent-browser state load auth.json

# Close
agent-browser close
```

### Semantic locators (alternative to refs)

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search..." fill "query"
agent-browser find testid "submit-btn" click
```

### Browser settings

```bash
agent-browser set viewport 1920 1080
agent-browser set device "iPhone 14"
agent-browser set geo 37.7749 -122.4194
agent-browser set offline on
agent-browser set media dark
```

### Network & debug

```bash
agent-browser network requests
agent-browser network requests --filter api
agent-browser network route <url> --abort          # Block requests
agent-browser network route <url> --body '{}'      # Mock response
agent-browser console                              # View console messages
agent-browser errors                               # View page errors
agent-browser eval "document.title"                # Run JavaScript
```

### Tabs & sessions

```bash
agent-browser tab                  # List tabs
agent-browser tab new [url]        # New tab
agent-browser tab 2                # Switch to tab
agent-browser tab close            # Close tab
agent-browser --session test1 open site-a.com  # Isolated session
```

### Video & profiling

```bash
agent-browser record start ./demo.webm
agent-browser record stop
agent-browser trace start
agent-browser trace stop trace.zip
agent-browser profiler start
agent-browser profiler stop profile.json
```

## Decision rules

| Need | Tool |
|---|---|
| One-off browser automation in this session | `browser` tool / `playwright` skill |
| Reproduce CI behavior locally | `playwright-cli` (this skill) — run via `bash` |
| Add a new regression test | `playwright-cli` — write it as a `*.spec.ts`, commit it |
| Quick visual check | `browser` tool's `tab.screenshot()` |
| Batch / headless operations from shell | `playwright-cli` (this skill) |

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

## Global options

| Option | Description |
|---|---|
| `--session <name>` | Isolated browser session |
| `--profile <path>` | Persistent browser profile |
| `--state <path>` | Load storage state from JSON file |
| `--headed` | Show browser window |
| `--cdp <port>` | Connect via Chrome DevTools Protocol |
| `--json` | Machine-readable JSON output |
| `--full` | Full page screenshot |
| `--annotate` | Annotated screenshot with numbered labels |

## Anti-patterns

- `page.click('.btn-primary')` — use `getByRole` / `getByLabel` / `getByText`
- Hardcoded `waitForTimeout(2000)` — use `expect(...).toBeVisible()` or `waitForResponse`
- `page.evaluate(() => …)` for things `getBy*` could do — keeps tests in browser-land
- Running `lighthouse` CLI directly — use real browser automation for auditing

## Example: Form submission

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output shows: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Example: Authentication with saved state

```bash
# Login once
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# Later sessions: load saved state
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```
