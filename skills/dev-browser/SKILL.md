---
name: dev-browser
description: Browser automation with persistent page state. Use when users ask to navigate websites, fill forms, take screenshots, extract web data, test web apps, or automate browser workflows.
---

# Dev Browser Skill

Browser automation that maintains page state across interactions. Work incrementally with small, focused steps. Once you've proven out part of a workflow and there is repeated work to do, batch the repeated work into a single execution.

## Choosing Your Approach

- **Local/source-available sites**: Use `read` to examine the source code first, then write selectors directly
- **Unknown page layouts**: Use `browser` tool's `tab.observe()` to discover elements and interact via element IDs
- **Visual feedback**: Use `browser` tool's `tab.screenshot()` to see what the user sees

## In OMP

OMP exposes the `browser` tool for browser automation. The core workflow:

1. `browser(action: "open", url: "<url>")` — open a tab and navigate
2. `browser(action: "run", code: "const obs = await tab.observe(); display(obs);")` — get accessibility snapshot with element IDs
3. Interact using element IDs from the snapshot: `(await tab.id(N)).click()`, `tab.fill(selector, value)`, etc.
4. `tab.screenshot()` — only when visual layout matters
5. `browser(action: "close")` — close when done

### Key `tab` helpers

| Helper | Purpose |
|---|---|
| `tab.goto(url)` | Navigate; clears element cache |
| `tab.observe()` | Accessibility snapshot: `{ url, title, elements: [{ id, role, name, value, states }] }` |
| `tab.id(n)` | Get ElementHandle from last observe → `.click()`, `.type()` |
| `tab.click(selector)` | Click by CSS/ARIA selector |
| `tab.type(selector, text)` | Type text |
| `tab.fill(selector, value)` | Fill input value |
| `tab.press(key)` | Press a key |
| `tab.scroll(dx, dy)` | Scroll the page |
| `tab.drag(from, to)` | Drag between selectors or `{x, y}` points |
| `tab.scrollIntoView(selector)` | Center element in viewport |
| `tab.select(selector, ...values)` | Set `<select>` option(s) |
| `tab.uploadFile(selector, ...paths)` | Attach files to `<input type="file">` |
| `tab.waitFor(selector)` | Wait until element is attached |
| `tab.waitForUrl(pattern)` | Wait for URL (substring or RegExp) |
| `tab.waitForResponse(pattern)` | Wait for network response |
| `tab.evaluate(fn, ...args)` | Run JS in page context |
| `tab.screenshot({ selector?, fullPage?, save? })` | Capture screenshot |
| `tab.extract(format)` | Readability-extracted content ("markdown" or "text") |

## Workflow Loop

Follow this pattern for complex tasks:

1. **Observe** — `tab.observe()` to understand page state
2. **Act** — interact with one or two elements
3. **Evaluate** — did it work? What's the current state?
4. **Decide** — is the task complete or do we need another step?
5. **Repeat** until task is done

## Selector Preferences

Prefer accessible / stable selectors over brittle CSS:

```
aria/Sign in          — ARIA role + name (best)
text/Continue         — visible text
[data-testid="..."]   — test IDs
#id                   — IDs (stable)
.MuiButton-root       — class names (AVOID — brittle)
```

Playwright-style `p-aria/…`, `p-text/…` are also supported.

## Scraping Data

For scraping large datasets, intercept and replay network requests rather than scrolling the DOM:

```js
// Capture API requests
const response = await tab.waitForResponse(r => r.url().includes('/api/data'));
const data = await response.json();
```

## Error Recovery

Page state persists after failures. Debug with:

```js
await tab.screenshot();  // see current state
const obs = await tab.observe();
display({ url: obs.url, title: obs.title, elementCount: obs.elements.length });
```

## When to use this vs the others

| Skill | Use case |
|---|---|
| `dev-browser` | Long-lived dev session, persistent page state across multiple turns |
| `playwright` | One-shot scripted automation via `browser` tool |
| `playwright-cli` | Headless CLI runs (CI, screenshots, scripted assertions) |

## Rules

- Default to `tab.observe()`, not `tab.screenshot()`. Only screenshot when visual layout matters.
- Prefer ARIA / text selectors (`aria/[name="Sign in"]`, `text/Continue`) over brittle CSS.
- Re-observe after navigation — element IDs are not durable across page loads.
- Close the browser when done: `browser(action: "close")`.
