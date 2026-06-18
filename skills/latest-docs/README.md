# latest-docs — Pi skill

Fetch, cache, and synthesize the latest official documentation for registered libraries and APIs. Follows the project's `--i-approve` idiom: fetch and show are read-only, register is the only mutation and produces a forensic JSONL audit log at `.pi/.docs-registry-log.jsonl` (mode 0600, gitignored).

See `SKILL.md` for the full command reference, registry schema, and example invocations. The sections below are for the human reader and operator.

## Shape

```
latest-docs/
  SKILL.md                              # model-facing capability doc
  README.md                             # this file
  registry.json                         # library → canonical URL map
  bin/latest-docs.ts                    # Bun CLI, exports dispatch(argv, opts)
  test/latest-docs.test.ts              # unit tests with injected fetch + turndown stubs
```

## Why turndown, not marked

The spec draft (§3.1) mentioned "marked + a simple HTML stripper" as the HTML-to-Markdown path. This is factually wrong about what `marked` does: `marked` is a **Markdown-to-HTML** renderer, not the reverse. There is no plausible reading of `marked` that produces Markdown from an HTML page.

The correct tool for HTML-to-Markdown in the Node/Bun ecosystem is [turndown](https://github.com/mixmark-io/turndown): roughly 18 KB, zero transitive dependencies, MIT license, and a decade of stability. It is configured with `headingStyle: "atx"` and `codeBlockStyle: "fenced"` so the output is clean `#`-headed, triple-backtick Markdown that renders correctly in Claude's context window and in standard Markdown viewers.

`turndown` is lazy-required at the CLI entry point (`realHtmlToMarkdown`) so unit tests can inject a stub without needing the dependency installed.

## The `verified: false` convention

Every entry in `registry.json` ships with `"verified": false`. This is intentional: the URLs were seeded from best-effort inference — GitHub README paths, official doc portals, known CDN patterns — but were not live-probed at commit time because outbound HTTP to arbitrary URLs was denied in the sandboxed environment where the implementer worked.

What `verified: false` means in practice:

- The URL is a reasonable best guess, not a confirmed endpoint.
- The first time you run `latest-docs fetch <lib> --refresh`, you will either get a clean cache file (flip `verified` to `true` in `registry.json` by hand) or an HTTP error (use `latest-docs register <lib> <corrected-url> --i-approve` to repair the entry, then retry).
- New entries written by `register --i-approve` also always start with `verified: false`, regardless of whether the URL was pre-checked. There is no CLI flag to set `verified: true`; it is a manual confirmation step.

The recommended smoke-pass procedure: after pulling this branch, run `latest-docs fetch <lib> --refresh` for each of the eleven seeded libraries. Any that succeed without error can have their `verified` field flipped to `true` in `registry.json`. Any that return a 404 or redirect failure need a `register` update before they are useful.

## HTML scoping: indexOf-based scan, not RegExp

The `scopeHtml` function in `bin/latest-docs.ts` finds the first occurrence of a tag element using `String.prototype.indexOf` against the lowercased HTML, not a dynamically constructed regular expression. This was a deliberate implementation choice, not a simplification:

1. **Semgrep safety.** The project's Semgrep rules flag dynamic `RegExp` construction (patterns like `new RegExp(userInput)`) because it is a known ReDoS vector. Even though the selector is already validated against `/^[a-zA-Z]+$/` before reaching the scan, building a regex from it would produce a Semgrep finding that would need suppression comments. The indexOf scan is structurally immune.

2. **ReDoS surface eliminated.** HTML can be arbitrarily large. A regex with backtracking over a multi-megabyte string could catastrophically backtrack on adversarial or malformed input. An indexOf loop has O(n) worst-case behaviour by construction.

The tradeoff is expressiveness: v1 supports only bare tag-name selectors. Class selectors (`.content`), id selectors (`#main-docs`), and compound selectors (`article > section`) are not supported. If `selector` contains any character outside `[a-zA-Z]`, `scopeHtml` returns the full HTML unchanged — scoping is skipped, not errored. This is intentional: a class or id selector is silently demoted to "no scoping" rather than producing an empty result.

This limitation is acceptable for the seeded registry, where all HTML entries use `main` or similar tag selectors pointing at documentation portals that reliably wrap content in a `<main>` element.

## TTL resolution

TTL for a cache entry is resolved in this order:

1. `ttl_days` on the specific registry entry (per-entry override).
2. `_meta.ttl_days_default` in `registry.json` (currently `7`).
3. Hardcoded fallback `7` if neither key is present.

All seeded entries carry an explicit `"ttl_days": 7` that matches the default. The per-entry field exists so high-churn libraries (e.g., a prerelease SDK iterating weekly) can be given a shorter TTL, and stable libraries (e.g., a specification document) can be given a longer one, without changing the project-wide default.

## Cross-skill boundaries

`latest-docs` is read-only against the network during `fetch` and `show`. It has no write path to the project's source tree, no shell execution, and no Honcho calls.

`register` is the sole mutation path and is bounded to `registry.json` and `.pi/.docs-registry-log.jsonl`. The audit log records every create and update with a before/after snapshot and an `approver` field (hardcoded to `"luci"` — the human who passed `--i-approve`).

The `doc-scout` agent holds the Honcho integration: it calls `honcho_recall` on entry and `honcho_remember` on exit. `latest-docs` itself is stateless beyond the filesystem cache.

## Post-slice hardening follow-up

The Opus validator flagged one non-blocking risk during slice-006 QA: `sanitizeLib` only replaces `/` with `-`, so a lib name like `..` would survive into `cacheDir` and could escape the cache directory via `path.join(cwd, ".pi", ".docs-cache", "..")`. This is not exploitable today because:

1. Lib names only enter the filesystem via `register --i-approve`, which is human-gated.
2. The audit log records every approved registration with before/after snapshots.
3. All other commands look up lib names as string keys into the existing registry, so they cannot introduce new names.

Recommended follow-up ticket: add a reject in `sanitizeLib` for names matching `^\.+$` or containing backslash/null bytes after slash replacement. Cheap belt-and-suspenders.

## Edge cases: handled vs. deferred

**Handled:**
- Cache miss on `show`: auto-fetches silently, then displays.
- Stale cache on `fetch` without `--refresh`: returns the cached path with a cache-hit message; no network call.
- Non-tag selector passed to `scopeHtml`: scoping is skipped, full HTML is converted.
- Fetch returns non-200: exits non-zero with the HTTP status in the error message.
- Network error on fetch: exits non-zero with the error message.
- `register` without `--i-approve`: prints DRAFT preview, exits 0 (not an error).

**Deferred to v2:**
- Class and id selectors in `scopeHtml` (`.sidebar`, `#content`).
- Parallel multi-library fetch in a single invocation (`latest-docs fetch @honcho-ai/sdk hono zod`).
- Full-text search over the cache (`latest-docs search "createSession"`).
- `latest-docs warm` to prefetch all registry entries in one pass.
- Automatic `verified` promotion after a successful fetch.
