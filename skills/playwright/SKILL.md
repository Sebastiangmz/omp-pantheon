---
name: playwright
description: Browser automation via the in-process Playwright/MCP-style API (the `browser` tool's `tab.*`/`page.*` helpers). Use for scripted in-session browsing, scraping, and UI testing. For general browser work prefer `dev-browser`; for shell/`npx playwright test` runs use `playwright-cli`.
---

# Browser Automation with Playwright

## Quick start (via OMP `browser` tool)

```
browser(action: "open", url: "<url>")                           # Navigate to page
browser(action: "run", code: "const s = await tab.observe(); display(s);")  # Get interactive elements
browser(action: "run", code: "(await tab.id(1)).click();")      # Click element by observed ID
browser(action: "run", code: "await tab.fill('input[name=q]', 'text');")    # Fill input
browser(action: "close")                                        # Close browser
```

## Core workflow

1. Navigate: `tab.goto(url)`
2. Observe: `tab.observe()` — returns elements with `{ id, role, name, value, states }`
3. Interact using IDs from the snapshot: `(await tab.id(N)).click()`
4. Re-observe after navigation or significant DOM changes (IDs are not durable)

## Commands mapped to OMP `browser` tool

### Navigation

| Action | OMP |
|---|---|
| Navigate to URL | `tab.goto(url)` |
| Go back | `await page.goBack()` |
| Go forward | `await page.goForward()` |
| Reload page | `await page.reload()` |
| Close browser | `browser(action: "close")` |

### Snapshot (page analysis)

Use `tab.observe()` to discover page elements. Returns an accessibility snapshot:

```js
const obs = await tab.observe();
// obs.elements: [{ id, role, name, value, states, ... }]
// Use tab.id(N) to get the ElementHandle for interaction
```

Options:
- `tab.observe({ includeAll: true })` — include all elements (not just interactive)
- `tab.observe({ viewportOnly: true })` — only visible elements

### Interactions (use IDs from observe)

```js
// Click by observed ID
(await tab.id(1)).click();

// Click by selector
await tab.click('aria/Submit');
await tab.click('text/Sign In');

// Fill input
await tab.fill('input[name=email]', 'user@example.com');

// Type text (keystroke by keystroke)
await tab.type('input[name=search]', 'query');

// Press key
await tab.press('Enter');

// Hover
await page.hover('aria/Menu');

// Select dropdown
await tab.select('select[name=country]', 'US');

// Scroll
await tab.scroll(0, 500);        // scroll down 500px
await tab.scrollIntoView('aria/Footer');  // scroll element into view

// Drag and drop
await tab.drag('aria/Item 1', 'aria/Drop Zone');

// Upload files
await tab.uploadFile('input[type=file]', '/path/to/file.pdf');
```

### Get information

```js
// Get element text
const text = await page.textContent('selector');

// Get input value
const val = await page.inputValue('selector');

// Get attribute
const href = await page.getAttribute('a', 'href');

// Get page title / URL
const title = await page.title();
const url = page.url();

// Evaluate JS in page
const result = await tab.evaluate(() => document.title);
```

### Screenshots & capture

```js
// Screenshot (visual analysis)
await tab.screenshot();                        // display inline
await tab.screenshot({ save: 'tmp/shot.png' }); // save to file
await tab.screenshot({ fullPage: true });      // full page
await tab.screenshot({ selector: '#main' });   // specific element

// Extract readable content
const md = await tab.extract('markdown');
```

### Wait

```js
// Wait for element
await tab.waitFor('aria/Dashboard');

// Wait for URL pattern
await tab.waitForUrl('**/dashboard');

// Wait for network response
const resp = await tab.waitForResponse(r => r.url().includes('/api/'));
const data = await resp.json();

// Wait for JS condition (via evaluate)
await page.waitForFunction(() => window.appReady === true);
```

### Semantic locators (preferred over CSS)

```js
// By role + accessible name
await tab.click('aria/Submit');

// By visible text
await tab.click('text/Sign In');

// By placeholder
await tab.fill('[placeholder="Search..."]', 'query');

// By test ID
await tab.click('[data-testid="submit-btn"]');
```

### Cookies & Storage

```js
// Get cookies
const cookies = await page.context().cookies();

// Set cookie
await page.context().addCookies([{ name: 'key', value: 'val', url: 'https://example.com' }]);

// Clear cookies
await page.context().clearCookies();

// Local/session storage via evaluate
await tab.evaluate(() => localStorage.getItem('key'));
await tab.evaluate((k, v) => localStorage.setItem(k, v), 'key', 'value');
```

## Decision rules

| Situation | Action |
|---|---|
| Need to know what's on the page | `tab.observe()`, NOT `tab.screenshot()` |
| Need to verify visual layout | `tab.screenshot({ selector })` if possible |
| Element keeps moving / re-rendering | `tab.waitFor(selector)` first |
| Need network-stable state | `tab.goto(url, { waitUntil: "networkidle2" })` |
| Need element off-screen | `tab.scrollIntoView(selector)` first, then interact |
| Form drag-and-drop | `tab.drag(from, to)` with selectors or `{ x, y }` points |
| Page changes after action | re-`tab.observe()` (IDs are not durable across navigations) |

## Anti-patterns

- `tab.screenshot()` to "see what's there" — use `tab.observe()`
- Brittle CSS selectors like `.MuiButton-root.css-1234` — prefer `aria/` or `text/`
- Polling with `tab.evaluate` in a tight loop — use `tab.waitFor` or `page.waitForFunction`
- Forgetting `browser(action: "close")` at the end of an automation chain

## Global options on `browser` tool

| Option | Description |
|---|---|
| `viewport: { width, height }` | Set viewport size on `open` |
| `wait_until` | Navigation wait: `load`, `domcontentloaded`, `networkidle0`, `networkidle2` |
| `dialogs: "accept" \| "dismiss"` | Auto-handle alert/confirm dialogs |

## When to use this vs the others

| Skill | Use case |
|---|---|
| `playwright` | One-shot scripted automation via `browser` tool (this skill) |
| `dev-browser` | Long-lived dev session, persistent page state across multiple turns |
| `playwright-cli` | Headless CLI runs (CI, screenshots, Playwright test runner) |
