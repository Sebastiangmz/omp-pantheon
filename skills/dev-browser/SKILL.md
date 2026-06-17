---
name: dev-browser
description: Browser automation with persistent page state. Use when users ask to navigate websites, fill forms, take screenshots, extract web data, test web apps, or automate browser workflows.
---

# dev-browser

Browser automation skill. Use when the user says: "go to [url]", "click on", "fill out the form", "take a screenshot", "scrape", "automate", "test the website", "log into", or any request involving live browser interaction.

## When to use this vs the others

| Skill | Use case |
|---|---|
| `dev-browser` | Long-lived dev session, persistent page state across multiple turns |
| `playwright` | One-shot scripted automation (Playwright MCP) |
| `playwright-cli` | Headless CLI runs (CI, screenshots, scripted assertions) |

## In OMP

OMP exposes the `puppeteer` tool (when enabled). For most operations, prefer `puppeteer.observe` to inspect the page state — it's faster and cheaper than `screenshot`.

Typical flow:
1. `puppeteer.open` (auto on first action)
2. `puppeteer.goto(url)`
3. `puppeteer.observe` to map elements with IDs
4. `puppeteer.click_id` / `puppeteer.type_id` / `puppeteer.fill_id` against returned IDs
5. `puppeteer.evaluate` for in-page JS when DOM-level ops aren't enough

## Rules

- Default to `observe`, not `screenshot`. Only screenshot when visual layout matters.
- Prefer ARIA / text selectors (`p-aria/[name="Sign in"]`, `p-text/Continue`) over brittle CSS.
- Batch DOM queries via `args: [{ selector, attribute? }, …]` when multiple are needed.
- Close the browser when done: `puppeteer.close`.

> iter-1 stub. Iter-2 will expand with concrete recipes (login, form-fill, scrape patterns).
