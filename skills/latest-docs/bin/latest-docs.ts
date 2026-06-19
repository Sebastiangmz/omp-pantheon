#!/usr/bin/env -S bun run
/**
 * latest-docs — fetch, cache, and expose the latest official documentation for
 * registered libraries/SDKs/APIs. Turns Luci's "always check latest official
 * docs" rule from prose into an executable contract.
 *
 * SpecSafe slice: SPEC-20260424-006 — latest-docs-and-doc-scout
 *
 * Commands:
 *   latest-docs list                          # enumerate registered libraries
 *   latest-docs fetch <lib> [--refresh]       # fetch + cache; prints cache path
 *   latest-docs show <lib> [--section=X]      # print cached content (auto-fetches if missing)
 *   latest-docs register <lib> <url> [--type=markdown|html] [--selector=CSS] \
 *                                   [--ttl-days=N]                    [--i-approve]
 *
 * Registry type: "markdown" entries are written verbatim; "html" entries are
 * fetched, scoped to a selector tag (default `main`), and converted to
 * Markdown via turndown.
 *
 * Cache layout: .pi/.docs-cache/<lib-sanitized>/<YYYY-MM-DD>.md
 * Each cache file begins with a YAML frontmatter block:
 *   ---
 *   source_url: https://...
 *   fetched_at: 2026-04-24T12:00:00.000Z
 *   content_hash: <sha256-hex-16>
 *   ---
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegistryEntry = {
	url: string;
	type: "markdown" | "html";
	selector?: string;
	ttl_days?: number;
	verified?: boolean;
};

export type RegistryMeta = {
	ttl_days_default?: number;
	note?: string;
};

export type Registry = {
	_meta?: RegistryMeta;
	[lib: string]: RegistryEntry | RegistryMeta | undefined;
};

export type FetchResponse = {
	ok: boolean;
	status: number;
	text(): Promise<string>;
};

export type FetchFn = (url: string) => Promise<FetchResponse>;

export type HtmlToMarkdown = (html: string) => string;

export type DispatchOpts = {
	cwd: string;
	env: Record<string, string | undefined>;
	fetchFn: FetchFn;
	htmlToMarkdown: HtmlToMarkdown;
	now?: () => Date;
};

export type DispatchResult = {
	stdout: string;
	stderr: string;
	exit: number;
};

// ---------------------------------------------------------------------------
// Registry I/O
// ---------------------------------------------------------------------------

function registryPath(cwd: string): string {
	const candidates = [
		path.join(cwd, "skills", "latest-docs", "registry.json"),
		path.join(cwd, ".omp", "skills", "latest-docs", "registry.json"),
		path.join(cwd, ".pi", "skills", "latest-docs", "registry.json"),
	];
	return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

export function loadRegistry(cwd: string): Registry {
	const p = registryPath(cwd);
	if (!fs.existsSync(p)) return { _meta: { ttl_days_default: 7 } };
	const raw = fs.readFileSync(p, "utf8");
	return JSON.parse(raw) as Registry;
}

function saveRegistry(cwd: string, registry: Registry): void {
	const p = registryPath(cwd);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(registry, null, 2) + "\n", {
		mode: 0o600,
	});
	fs.chmodSync(p, 0o600); // belt-and-braces when file pre-existed
}

function isEntry(v: unknown): v is RegistryEntry {
	return (
		!!v && typeof v === "object" && typeof (v as RegistryEntry).url === "string"
	);
}

function entriesOf(registry: Registry): Array<[string, RegistryEntry]> {
	const out: Array<[string, RegistryEntry]> = [];
	for (const [key, val] of Object.entries(registry)) {
		if (key === "_meta") continue;
		if (isEntry(val)) out.push([key, val]);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Cache path helpers
// ---------------------------------------------------------------------------

export function sanitizeLib(lib: string): string {
	// Reject path-traversal tokens and control characters. Only --i-approve'd
	// register calls can add new lib names, but defense-in-depth is cheap.
	if (/^\.+$/.test(lib) || lib.includes("..") || /[\\\0]/.test(lib)) {
		throw new Error(`invalid lib name (path-traversal rejected): ${lib}`);
	}
	// @linear/sdk → @linear-sdk (keep @, replace slashes).
	return lib.replace(/\//g, "-");
}

function cacheDir(cwd: string, lib: string): string {
	return path.join(cwd, ".pi", ".docs-cache", sanitizeLib(lib));
}

function isoDate(d: Date): string {
	// YYYY-MM-DD
	return d.toISOString().slice(0, 10);
}

function listCacheFiles(cwd: string, lib: string): string[] {
	const dir = cacheDir(cwd, lib);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
		.sort(); // ascending — last element is newest
}

function mostRecentCacheFile(cwd: string, lib: string): string | null {
	const files = listCacheFiles(cwd, lib);
	if (files.length === 0) return null;
	return path.join(cacheDir(cwd, lib), files[files.length - 1]!);
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

export type Frontmatter = {
	source_url: string;
	fetched_at: string;
	content_hash: string;
};

function writeCacheFile(
	cwd: string,
	lib: string,
	date: Date,
	sourceUrl: string,
	body: string,
): string {
	const dir = cacheDir(cwd, lib);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${isoDate(date)}.md`);
	const hash = crypto
		.createHash("sha256")
		.update(body)
		.digest("hex")
		.slice(0, 16);
	const frontmatter = [
		"---",
		`source_url: ${sourceUrl}`,
		`fetched_at: ${date.toISOString()}`,
		`content_hash: ${hash}`,
		"---",
		"",
	].join("\n");
	fs.writeFileSync(
		file,
		frontmatter + body + (body.endsWith("\n") ? "" : "\n"),
	);
	return file;
}

export function parseFrontmatter(content: string): {
	frontmatter: Frontmatter | null;
	body: string;
} {
	if (!content.startsWith("---\n")) return { frontmatter: null, body: content };
	const end = content.indexOf("\n---\n", 4);
	if (end < 0) return { frontmatter: null, body: content };
	const block = content.slice(4, end);
	const body = content.slice(end + 5);
	const fm: Partial<Frontmatter> = {};
	for (const line of block.split("\n")) {
		const m = line.match(/^([a-z_]+):\s*(.+)$/);
		if (!m) continue;
		const key = m[1] as keyof Frontmatter;
		(fm as Record<string, string>)[key] = m[2]!.trim();
	}
	if (!fm.source_url || !fm.fetched_at || !fm.content_hash) {
		return { frontmatter: null, body: content };
	}
	return { frontmatter: fm as Frontmatter, body };
}

// ---------------------------------------------------------------------------
// HTML scoping
// ---------------------------------------------------------------------------

export function scopeHtml(html: string, selector: string): string {
	// v1: only tag-name selectors (main, article, section, body).
	// Non-tag selectors (classes, ids) skip scoping gracefully.
	// No dynamic RegExp — string scan avoids ReDoS risk entirely.
	if (!/^[a-z]+$/i.test(selector)) return html;
	const tag = selector.toLowerCase();
	const haystack = html.toLowerCase();
	const openPrefix = `<${tag}`;
	const closeTag = `</${tag}>`;

	let searchFrom = 0;
	while (searchFrom < haystack.length) {
		const idx = haystack.indexOf(openPrefix, searchFrom);
		if (idx < 0) return html;
		// Verify the char after the tag name is a word boundary (space, >, /, tab, newline).
		const next = haystack.charAt(idx + openPrefix.length);
		if (next !== "" && !/[\s/>]/.test(next)) {
			searchFrom = idx + openPrefix.length;
			continue;
		}
		const openEnd = haystack.indexOf(">", idx);
		if (openEnd < 0) return html;
		const closeIdx = haystack.indexOf(closeTag, openEnd + 1);
		if (closeIdx < 0) return html;
		return html.slice(openEnd + 1, closeIdx);
	}
	return html;
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

function ageInDays(fetchedAt: string, now: Date): number {
	const then = new Date(fetchedAt).getTime();
	return (now.getTime() - then) / (1000 * 60 * 60 * 24);
}

function ttlForEntry(entry: RegistryEntry, registry: Registry): number {
	return entry.ttl_days ?? registry._meta?.ttl_days_default ?? 7;
}

// ---------------------------------------------------------------------------
// Section extraction (grep-match a markdown header + print its subtree)
// ---------------------------------------------------------------------------

export function extractSection(body: string, needle: string): string | null {
	const lines = body.split("\n");
	const needleLower = needle.toLowerCase();
	let startIdx = -1;
	let startLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const h = line.match(/^(#+)\s+(.+?)\s*$/);
		if (!h) continue;
		if (h[2]!.toLowerCase().includes(needleLower)) {
			startIdx = i;
			startLevel = h[1]!.length;
			break;
		}
	}
	if (startIdx < 0) return null;
	const out = [lines[startIdx]!];
	for (let i = startIdx + 1; i < lines.length; i++) {
		const line = lines[i]!;
		const h = line.match(/^(#+)\s+/);
		if (h && h[1]!.length <= startLevel) break;
		out.push(line);
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList(
	cwd: string,
	registry: Registry,
	now: Date,
): Promise<DispatchResult> {
	const entries = entriesOf(registry);
	if (entries.length === 0) {
		return { stdout: "(registry is empty)\n", stderr: "", exit: 0 };
	}
	const lines: string[] = [];
	lines.push("library                        type      last-fetched    url");
	lines.push("----------------------------- --------  --------------  ---");
	for (const [lib, entry] of entries) {
		const recent = mostRecentCacheFile(cwd, lib);
		let lastFetched = "never";
		if (recent) {
			const content = fs.readFileSync(recent, "utf8");
			const fm = parseFrontmatter(content).frontmatter;
			if (fm) {
				const age = ageInDays(fm.fetched_at, now);
				const ttl = ttlForEntry(entry, registry);
				lastFetched =
					age > ttl
						? `${isoDate(new Date(fm.fetched_at))} (stale)`
						: isoDate(new Date(fm.fetched_at));
			}
		}
		lines.push(
			`${lib.padEnd(30)} ${entry.type.padEnd(8)}  ${lastFetched.padEnd(14)}  ${entry.url}`,
		);
	}
	return { stdout: lines.join("\n") + "\n", stderr: "", exit: 0 };
}

async function cmdFetch(
	lib: string,
	opts: { refresh: boolean },
	cwd: string,
	registry: Registry,
	fetchFn: FetchFn,
	htmlToMarkdown: HtmlToMarkdown,
	now: Date,
): Promise<DispatchResult> {
	const entry = registry[lib];
	if (!isEntry(entry)) {
		return {
			stdout: "",
			stderr: `not in registry: ${lib}\n\nRegister first: latest-docs register ${lib} <url> --i-approve`,
			exit: 1,
		};
	}

	// Check freshness unless --refresh
	if (!opts.refresh) {
		const recent = mostRecentCacheFile(cwd, lib);
		if (recent) {
			const content = fs.readFileSync(recent, "utf8");
			const fm = parseFrontmatter(content).frontmatter;
			if (fm) {
				const age = ageInDays(fm.fetched_at, now);
				const ttl = ttlForEntry(entry, registry);
				if (age <= ttl) {
					return {
						stdout: `cache hit (age ${age.toFixed(1)}d, ttl ${ttl}d): ${recent}\n`,
						stderr: "",
						exit: 0,
					};
				}
			}
		}
	}

	// Fetch
	let response: FetchResponse;
	try {
		response = await fetchFn(entry.url);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { stdout: "", stderr: `fetch failed: ${msg}`, exit: 2 };
	}
	if (!response.ok) {
		return {
			stdout: "",
			stderr: `fetch failed: HTTP ${response.status} for ${entry.url}`,
			exit: 2,
		};
	}

	const raw = await response.text();
	let body: string;
	if (entry.type === "markdown") {
		body = raw;
	} else {
		// html
		const scoped = entry.selector ? scopeHtml(raw, entry.selector) : raw;
		body = htmlToMarkdown(scoped);
	}

	const file = writeCacheFile(cwd, lib, now, entry.url, body);
	return {
		stdout: `fetched: ${file}\n`,
		stderr: "",
		exit: 0,
	};
}

async function cmdShow(
	lib: string,
	opts: { section?: string },
	cwd: string,
	registry: Registry,
	fetchFn: FetchFn,
	htmlToMarkdown: HtmlToMarkdown,
	now: Date,
): Promise<DispatchResult> {
	const entry = registry[lib];
	if (!isEntry(entry)) {
		return { stdout: "", stderr: `not in registry: ${lib}`, exit: 1 };
	}

	// If no cache, fetch first.
	let file = mostRecentCacheFile(cwd, lib);
	if (!file) {
		const fetched = await cmdFetch(
			lib,
			{ refresh: false },
			cwd,
			registry,
			fetchFn,
			htmlToMarkdown,
			now,
		);
		if (fetched.exit !== 0) return fetched;
		file = mostRecentCacheFile(cwd, lib);
		if (!file) {
			return {
				stdout: "",
				stderr: "fetch succeeded but cache file missing",
				exit: 2,
			};
		}
	}

	const content = fs.readFileSync(file, "utf8");
	const { frontmatter, body } = parseFrontmatter(content);

	// Stale warning
	let header = "";
	if (frontmatter) {
		const age = ageInDays(frontmatter.fetched_at, now);
		const ttl = ttlForEntry(entry, registry);
		if (age > ttl) {
			header = `[stale ${age.toFixed(1)} days; ttl ${ttl}; refresh with: latest-docs fetch ${lib} --refresh]\n\n`;
		}
	}

	if (opts.section) {
		const section = extractSection(body, opts.section);
		if (!section) {
			return {
				stdout: "",
				stderr: `section not found: ${opts.section}`,
				exit: 1,
			};
		}
		return { stdout: header + section + "\n", stderr: "", exit: 0 };
	}

	return { stdout: header + body, stderr: "", exit: 0 };
}

async function cmdRegister(
	argv: string[],
	cwd: string,
	registry: Registry,
	now: Date,
): Promise<DispatchResult> {
	const lib = argv[0];
	const url = argv[1];
	if (!lib || !url) {
		return {
			stdout: "",
			stderr:
				"usage: latest-docs register <lib> <url> [--type=markdown|html] [--selector=CSS] [--ttl-days=N] [--i-approve]",
			exit: 1,
		};
	}

	let type: "markdown" | "html" = "markdown";
	let selector: string | undefined;
	let ttlDays: number | undefined;
	let approve = false;
	for (const arg of argv.slice(2)) {
		if (arg === "--i-approve") approve = true;
		else if (arg.startsWith("--type=")) {
			const v = arg.slice("--type=".length);
			if (v !== "markdown" && v !== "html") {
				return {
					stdout: "",
					stderr: `invalid --type: ${v} (must be markdown|html)`,
					exit: 1,
				};
			}
			type = v;
		} else if (arg.startsWith("--selector="))
			selector = arg.slice("--selector=".length);
		else if (arg.startsWith("--ttl-days="))
			ttlDays = parseInt(arg.slice("--ttl-days=".length), 10);
	}

	const entry: RegistryEntry = { url, type, verified: false };
	if (selector) entry.selector = selector;
	if (typeof ttlDays === "number" && !Number.isNaN(ttlDays))
		entry.ttl_days = ttlDays;

	if (!approve) {
		return {
			stdout:
				`DRAFT — would register:\n` +
				`  ${lib}\n` +
				`  url:      ${entry.url}\n` +
				`  type:     ${entry.type}\n` +
				`  selector: ${entry.selector ?? "(none)"}\n` +
				`  ttl_days: ${entry.ttl_days ?? "(default)"}\n\n` +
				`Rerun with --i-approve to write to registry.\n`,
			stderr: "",
			exit: 0,
		};
	}

	const prior = isEntry(registry[lib])
		? (registry[lib] as RegistryEntry)
		: null;
	registry[lib] = entry;
	saveRegistry(cwd, registry);

	// Audit log
	const logFile = path.join(cwd, ".pi", ".docs-registry-log.jsonl");
	fs.mkdirSync(path.dirname(logFile), { recursive: true });
	if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, "", { mode: 0o600 });
	const logEntry = {
		ts: now.toISOString(),
		action: prior ? "update" : "create",
		lib,
		before: prior,
		after: entry,
		approver: "luci",
	};
	fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
	fs.chmodSync(logFile, 0o600);

	return {
		stdout: `${prior ? "updated" : "registered"}: ${lib} → ${entry.url}\n`,
		stderr: "",
		exit: 0,
	};
}

// ---------------------------------------------------------------------------
// Argument parsing helper
// ---------------------------------------------------------------------------

function parseFlag(argv: string[], name: string): boolean {
	return argv.includes(name);
}

function parseValue(argv: string[], prefix: string): string | undefined {
	for (const a of argv) {
		if (a.startsWith(prefix)) return a.slice(prefix.length);
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatch(
	argv: string[],
	opts: DispatchOpts,
): Promise<DispatchResult> {
	const [command, ...rest] = argv;
	const now = opts.now?.() ?? new Date();
	const registry = loadRegistry(opts.cwd);

	switch (command) {
		case "list":
			return cmdList(opts.cwd, registry, now);

		case "fetch": {
			const lib = rest[0];
			if (!lib)
				return {
					stdout: "",
					stderr: "usage: latest-docs fetch <lib> [--refresh]",
					exit: 1,
				};
			const refresh = parseFlag(rest, "--refresh");
			return cmdFetch(
				lib,
				{ refresh },
				opts.cwd,
				registry,
				opts.fetchFn,
				opts.htmlToMarkdown,
				now,
			);
		}

		case "show": {
			const lib = rest[0];
			if (!lib)
				return {
					stdout: "",
					stderr: "usage: latest-docs show <lib> [--section=X]",
					exit: 1,
				};
			const section = parseValue(rest, "--section=");
			return cmdShow(
				lib,
				{ section },
				opts.cwd,
				registry,
				opts.fetchFn,
				opts.htmlToMarkdown,
				now,
			);
		}

		case "register":
			return cmdRegister(rest, opts.cwd, registry, now);

		default:
			return {
				stdout: "",
				stderr: `unknown command: ${command ?? "(none)"}

Usage:
  latest-docs list
  latest-docs fetch <lib> [--refresh]
  latest-docs show <lib> [--section=X]
  latest-docs register <lib> <url> [--type=markdown|html] [--selector=CSS] [--ttl-days=N] [--i-approve]
`,
				exit: 1,
			};
	}
}

// ---------------------------------------------------------------------------
// Real factories (used by the CLI entry point only)
// ---------------------------------------------------------------------------

function realFetchFn(url: string): Promise<FetchResponse> {
	return fetch(url) as unknown as Promise<FetchResponse>;
}

function realHtmlToMarkdown(html: string): string {
	// Lazy-require so unit tests don't need turndown to be installed
	// (they inject a stub). We require() here only when actually running.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const TurndownService = require("turndown");
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
	});
	return turndown.turndown(html);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
	const result = await dispatch(process.argv.slice(2), {
		cwd: process.cwd(),
		env: process.env as Record<string, string | undefined>,
		fetchFn: realFetchFn,
		htmlToMarkdown: realHtmlToMarkdown,
	});

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr + "\n");
	process.exit(result.exit);
}
