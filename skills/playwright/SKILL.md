---
name: playwright
description: MUST USE for any browser-related tasks. Browser automation via Playwright MCP — verification, browsing, information gathering, web scraping, testing, screenshots, and all browser interactions.
---

# playwright

This skill covers browser automation when a Playwright-style runtime is available (either an MCP server or `puppeteer` tool).

## In OMP

OMP exposes the `puppeteer` tool with Playwright-compatible semantics. Selectors that start with `aria/` or `text/` are first-class — prefer them over CSS.

## Standard recipe

```
puppeteer.goto({ url })
puppeteer.observe()                 # numbered accessibility snapshot
puppeteer.click_id({ element_id })  # interact via observed IDs
puppeteer.evaluate({ script })      # in-page JS escape hatch
puppeteer.screenshot({ path })      # only when visual matters
puppeteer.close()
```

## Decision rules

| Situation | Action |
|---|---|
| Need to know what's on the page | `observe`, NOT `screenshot` |
| Need to verify visual layout | `screenshot` with `selector` if possible |
| Element keeps moving / re-rendering | `wait_for_selector` first |
| Need network-stable state | `wait_until: "networkidle2"` on `goto` |
| Need element off-screen | `scroll` first, then interact |
| Form drag-and-drop | `drag` with `from_selector` / `to_selector` |
| Page changes after action | re-`observe` (IDs are not durable across navigations) |

## Anti-patterns

- ❌ `screenshot` to "see what's there" — use `observe`
- ❌ Brittle CSS selectors like `.MuiButton-root.css-1234` — prefer `aria/` or `text/`
- ❌ Polling with `evaluate` in a tight loop — use `wait_for_selector`
- ❌ Forgetting `close` at the end of an automation chain

> iter-1 stub. Iter-2 will expand with login flows, file-upload patterns, and CI integration.
