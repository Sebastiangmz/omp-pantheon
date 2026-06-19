---
name: latest-docs
description: Fetch, cache, and expose the latest official documentation for registered libraries, SDKs, and APIs. Turns Luci's "always check latest official docs" rule from prose into an executable contract.
---

# latest-docs skill

`latest-docs` is the read-side enforcer of the project's documentation rule: training-data recall is not authoritative. Every agent that writes code against an external library must either invoke this skill directly or dispatch to `doc-scout`, which delegates to it. The skill fetches from canonical vendor URLs, writes a Markdown cache file, and surfaces a stale warning when the cache is past its TTL.

All fetch operations are network-read-only. The only mutation path is `register`, which is gated behind `--i-approve` and audit-logged.

## Commands

### list

```
latest-docs list
```

Enumerates every entry in `registry.json`. For each library, prints:

- library name
- type (`markdown` or `html`)
- last-fetched date (or `never` if no cache file exists)
- whether the cache is stale relative to the entry's TTL
- canonical URL

### fetch

```
latest-docs fetch <lib> [--refresh]
```

Fetches and caches documentation for `<lib>`.

Without `--refresh`: if a cache file already exists and its `fetched_at` timestamp is within the entry's TTL, prints a cache-hit message and returns immediately. No network call is made.

With `--refresh`: skips the TTL check and always fetches from the network.

On success, prints the path to the written cache file. On HTTP failure, exits non-zero with the status code. On network error, exits non-zero with the error message.

If `<lib>` is not in the registry, exits non-zero with a message directing you to `register` first.

### show

```
latest-docs show <lib> [--section=<header>]
```

Prints the cached documentation for `<lib>`. If no cache file exists, performs an automatic fetch first (equivalent to `fetch` without `--refresh`).

If the cache is older than the entry's TTL, the first line of output is a stale warning:

```
[stale 9.2 days; ttl 7; refresh with: latest-docs fetch @linear/sdk --refresh]
```

`--section=<header>` grep-matches a Markdown header by substring (case-insensitive) and prints the matched header plus everything under it, stopping at the next heading of the same or higher level. If no matching header is found, exits non-zero.

### register

```
latest-docs register <lib> <url> [--type=markdown|html] [--selector=<tag>] [--ttl-days=<N>] [--i-approve]
```

Adds or updates a registry entry for `<lib>`.

Without `--i-approve`, prints a DRAFT preview of what would be written and exits 0. No file is modified:

```
DRAFT — would register:
  new-lib
  url:      https://example.com/docs
  type:     markdown
  selector: (none)
  ttl_days: (default)

Rerun with --i-approve to write to registry.
```

With `--i-approve`, writes the entry to `registry.json` and appends one JSON line to `.pi/.docs-registry-log.jsonl` (mode 0600). New entries always start with `"verified": false`; after confirming the URL fetches correctly, flip the flag to `true` by editing `registry.json` directly (there is no CLI flag for this).

Flags:

| Flag | Default | Meaning |
|---|---|---|
| `--type=markdown\|html` | `markdown` | `markdown` writes the response body verbatim. `html` scopes to `--selector` and converts to Markdown. |
| `--selector=<tag>` | (none, full page) | Tag-name selector applied before HTML conversion. See [HTML scoping](#html-scoping-and-selector-support) below. |
| `--ttl-days=<N>` | (registry default) | Per-entry TTL override, in days. |
| `--i-approve` | off | Required to write any change. |

## Cache layout

```
.omp/.docs-cache/
  @linear-sdk/
    2026-04-24.md
    2026-05-01.md    # re-fetched after expiry
  hono/
    2026-04-24.md
```

Library names are sanitized for use as directory names: forward slashes are replaced with hyphens. `@linear/sdk` becomes `@linear-sdk`. The `@` prefix is preserved.

Each cache file is named `<YYYY-MM-DD>.md` (the date at fetch time). The skill retains old dated files — it does not delete them. `show` and `list` always use the most recent one.

### Cache file frontmatter

Every cache file begins with a YAML block:

```yaml
---
source_url: https://raw.githubusercontent.com/linear/linear/master/packages/sdk/README.md
fetched_at: 2026-04-24T12:00:00.000Z
content_hash: a3f7c8d1e4b290ab
---
```

`content_hash` is the first 16 hex characters of the SHA-256 of the body. It is present for change-detection purposes but is not currently compared automatically.

## TTL behavior

Staleness is evaluated against the entry's effective TTL, resolved in this order:

1. `ttl_days` field on the registry entry (per-entry override).
2. `_meta.ttl_days_default` in `registry.json` (project-wide default, currently `7`).
3. Hardcoded fallback of `7` if neither is present.

`list` appends `(stale)` to the last-fetched date when the age exceeds the TTL. `show` prepends a stale-warning line. `fetch` without `--refresh` respects the TTL as a cache-hit guard.

## Registry schema

`registry.json` is a plain JSON object. Keys are library names (e.g., `@linear/sdk`). The special key `_meta` holds registry-wide settings.

### Entry fields

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Canonical documentation URL. |
| `type` | `"markdown"` \| `"html"` | yes | How the response body is processed before caching. |
| `selector` | string | no | HTML tag-name selector for scoping before conversion (type `html` only). |
| `ttl_days` | number | no | Per-entry cache TTL in days. Overrides `_meta.ttl_days_default`. |
| `verified` | boolean | no | Whether the URL has been live-confirmed by a successful fetch. Defaults to `false` on all `register` writes. Flip to `true` manually after a successful smoke fetch. |

### `_meta` fields

| Field | Type | Description |
|---|---|---|
| `ttl_days_default` | number | Default TTL for entries that don't specify `ttl_days`. |
| `note` | string | Free-text note for human readers. |

### Example entry

```json
"@linear/sdk": {
  "url": "https://raw.githubusercontent.com/linear/linear/master/packages/sdk/README.md",
  "type": "markdown",
  "ttl_days": 7,
  "verified": false
}
```

## HTML scoping and selector support

When `type` is `html`, the skill scopes the fetched HTML to the element matching `selector` before conversion. This concentrates the cache on the relevant documentation region and discards nav bars, footers, and cookie banners.

**v1 limitation: tag-name selectors only.** Supported values are bare tag names — `main`, `article`, `section`, `body`, etc. Class selectors (`.content`), id selectors (`#docs`), and attribute selectors are not supported; if the selector contains any character that is not `[a-zA-Z]`, scoping is skipped and the full HTML body is converted. This is a deliberate no-op fallback, not an error.

The implementation uses an indexOf-based string scan on the lowercase HTML. See `README.md` for the rationale behind this approach.

## Audit log

`register --i-approve` appends one JSON line to `.pi/.docs-registry-log.jsonl`:

```json
{"ts":"2026-04-24T12:00:00.000Z","action":"create","lib":"new-lib","before":null,"after":{"url":"...","type":"markdown","verified":false},"approver":"luci"}
```

For updates (`action: "update"`), `before` is the prior registry entry. The log file is created mode 0600 and never truncated.

## Example invocations

```bash
# List all registered libraries with freshness status
bun run .omp/skills/latest-docs/bin/latest-docs.ts list

# Fetch (cache-aware — skips network if fresh)
bun run .omp/skills/latest-docs/bin/latest-docs.ts fetch @linear/sdk

# Force re-fetch regardless of TTL
bun run .omp/skills/latest-docs/bin/latest-docs.ts fetch @linear/sdk --refresh

# Print full cached docs
bun run .omp/skills/latest-docs/bin/latest-docs.ts show hono

# Print only the "Getting Started" subtree
bun run .omp/skills/latest-docs/bin/latest-docs.ts show hono --section="Getting Started"

# Preview a new registration (no-op, exit 0)
bun run .omp/skills/latest-docs/bin/latest-docs.ts register my-lib https://example.com/docs --type=html --selector=main

# Commit the registration and audit-log it
bun run .omp/skills/latest-docs/bin/latest-docs.ts register my-lib https://example.com/docs --type=html --selector=main --i-approve
```

## Integration with doc-scout

`doc-scout` is the agent wrapper around this skill. Other agents that need library context dispatch to `doc-scout` rather than invoking `latest-docs` directly. This keeps the implementer, validator, and reviewer contexts uncluttered by raw HTML conversion output and limits network access to a single, auditable agent.

When calling this skill from a Claude context directly (rather than via doc-scout), the invocation pattern is:

```
/skill:latest-docs show <lib>
/skill:latest-docs show <lib> --section=<header>
```
