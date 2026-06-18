/**
 * Tests for the latest-docs skill — bin/latest-docs.ts
 *
 * SpecSafe slice: SPEC-20260424-006 — latest-docs-and-doc-scout
 *
 * All tests inject a fake fetchFn and (optionally) a fake htmlToMarkdown so
 * there is zero network I/O. Real turndown is run in one end-to-end test
 * to verify the HTML→MD integration point — it runs in-process on a fixed
 * HTML string, no fetch.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import TurndownService from "turndown";

import {
	dispatch,
	extractSection,
	loadRegistry,
	parseFrontmatter,
	sanitizeLib,
	scopeHtml,
	type FetchFn,
	type FetchResponse,
	type HtmlToMarkdown,
	type Registry,
} from "../bin/latest-docs.ts";

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

type TestEnv = {
	cwd: string;
	tmpDir: string;
};

const envs: TestEnv[] = [];

function mkEnv(registry?: Registry): TestEnv {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-latest-docs-"));
	const cwd = path.join(tmpDir, "repo");
	fs.mkdirSync(path.join(cwd, ".pi", "skills", "latest-docs"), {
		recursive: true,
	});
	const r = registry ?? {
		_meta: { ttl_days_default: 7 },
		"@honcho-ai/sdk": {
			url: "https://example.com/honcho-readme.md",
			type: "markdown",
			verified: false,
		},
		hono: {
			url: "https://hono.example/docs",
			type: "html",
			selector: "main",
			verified: false,
		},
	};
	fs.writeFileSync(
		path.join(cwd, ".pi", "skills", "latest-docs", "registry.json"),
		JSON.stringify(r, null, 2),
	);
	const env: TestEnv = { cwd, tmpDir };
	envs.push(env);
	return env;
}

afterEach(() => {
	while (envs.length) {
		const e = envs.pop()!;
		try {
			fs.rmSync(e.tmpDir, { recursive: true, force: true });
		} catch {}
	}
});

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

function mockFetch(
	responses: Record<string, { status?: number; body: string }>,
): FetchFn {
	return async (url: string): Promise<FetchResponse> => {
		const r = responses[url];
		if (!r) {
			return {
				ok: false,
				status: 404,
				text: async () => "not found",
			};
		}
		const status = r.status ?? 200;
		return {
			ok: status >= 200 && status < 300,
			status,
			text: async () => r.body,
		};
	};
}

const noopHtmlToMd: HtmlToMarkdown = (html) => `[md-of] ${html.length} chars`;

// ---------------------------------------------------------------------------
// Pure helpers — direct unit tests
// ---------------------------------------------------------------------------

describe("scopeHtml", () => {
	test("extracts content of <main> tag", () => {
		const html =
			"<html><body><nav>skip</nav><main>keep this</main><footer>skip</footer></body></html>";
		expect(scopeHtml(html, "main")).toBe("keep this");
	});

	test("case-insensitive match", () => {
		expect(scopeHtml("<MAIN>hi</MAIN>", "main")).toBe("hi");
	});

	test("handles attributes on the tag", () => {
		expect(scopeHtml('<main id="x" class="y">body</main>', "main")).toBe(
			"body",
		);
	});

	test("word-boundary check — does not match prefix collisions", () => {
		const html = "<maintenance>wrong</maintenance><main>right</main>";
		expect(scopeHtml(html, "main")).toBe("right");
	});

	test("falls back to full html when selector not found", () => {
		const html = "<article>no main here</article>";
		expect(scopeHtml(html, "main")).toBe(html);
	});

	test("rejects non-tag selectors gracefully (no scoping, no crash)", () => {
		const html = "<div class='x'>body</div>";
		expect(scopeHtml(html, ".my-class")).toBe(html);
		expect(scopeHtml(html, "#my-id")).toBe(html);
	});
});

describe("parseFrontmatter", () => {
	test("parses a valid block", () => {
		const content =
			"---\nsource_url: https://x.com\nfetched_at: 2026-04-24T00:00:00Z\ncontent_hash: abc\n---\nbody here\n";
		const { frontmatter, body } = parseFrontmatter(content);
		expect(frontmatter).toEqual({
			source_url: "https://x.com",
			fetched_at: "2026-04-24T00:00:00Z",
			content_hash: "abc",
		});
		expect(body).toBe("body here\n");
	});

	test("returns null for missing frontmatter", () => {
		const { frontmatter, body } = parseFrontmatter("# just a doc\n");
		expect(frontmatter).toBeNull();
		expect(body).toBe("# just a doc\n");
	});

	test("returns null for incomplete frontmatter", () => {
		const { frontmatter } = parseFrontmatter("---\nsource_url: x\n---\nbody");
		expect(frontmatter).toBeNull();
	});
});

describe("extractSection", () => {
	const doc = `# Title\n\nintro text\n\n## Installation\n\nrun npm install\n\n### sub\n\ndetail\n\n## Usage\n\nexample code\n`;

	test("returns the named section + its subtree, stops at same or higher level", () => {
		const got = extractSection(doc, "Installation");
		expect(got).toContain("## Installation");
		expect(got).toContain("run npm install");
		expect(got).toContain("### sub");
		expect(got).toContain("detail");
		expect(got).not.toContain("## Usage");
		expect(got).not.toContain("example code");
	});

	test("case-insensitive match", () => {
		expect(extractSection(doc, "installation")).toContain("## Installation");
	});

	test("returns null for missing section", () => {
		expect(extractSection(doc, "nonexistent")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Dispatch — list
// ---------------------------------------------------------------------------

describe("list", () => {
	test("AC1: list enumerates registered libraries with last-fetched column", async () => {
		const env = mkEnv();
		const result = await dispatch(["list"], {
			cwd: env.cwd,
			env: {},
			fetchFn: mockFetch({}),
			htmlToMarkdown: noopHtmlToMd,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("@honcho-ai/sdk");
		expect(result.stdout).toContain("hono");
		expect(result.stdout).toContain("never"); // no cache yet
		expect(result.stdout).toContain("markdown");
		expect(result.stdout).toContain("html");
	});

	test("list shows last-fetched date after a fetch", async () => {
		const env = mkEnv();
		const fetchFn = mockFetch({
			"https://example.com/honcho-readme.md": { body: "# Honcho\n\nhello\n" },
		});
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		const result = await dispatch(["list"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		expect(result.stdout).toContain("2026-04-24");
	});
});

// ---------------------------------------------------------------------------
// Dispatch — fetch
// ---------------------------------------------------------------------------

describe("fetch", () => {
	test("AC2: fetch writes Markdown with YAML frontmatter to dated cache path", async () => {
		const env = mkEnv();
		const fetchFn = mockFetch({
			"https://example.com/honcho-readme.md": {
				body: "# Honcho SDK\n\nuse it\n",
			},
		});
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		const result = await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain(".docs-cache");
		expect(result.stdout).toContain("@honcho-ai-sdk");
		expect(result.stdout).toContain("2026-04-24.md");

		// Verify file on disk
		const file = path.join(
			env.cwd,
			".pi",
			".docs-cache",
			"@honcho-ai-sdk",
			"2026-04-24.md",
		);
		expect(fs.existsSync(file)).toBe(true);
		const content = fs.readFileSync(file, "utf8");
		expect(content).toContain(
			"---\nsource_url: https://example.com/honcho-readme.md",
		);
		expect(content).toContain("content_hash:");
		expect(content).toContain("# Honcho SDK");
	});

	test("type=html runs htmlToMarkdown with selector scoping", async () => {
		const env = mkEnv();
		const fetchFn = mockFetch({
			"https://hono.example/docs": {
				body: "<html><nav>skip</nav><main>keep me</main></html>",
			},
		});
		const calls: string[] = [];
		const capturingHtmlToMd: HtmlToMarkdown = (h) => {
			calls.push(h);
			return `converted: ${h}`;
		};
		await dispatch(["fetch", "hono"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: capturingHtmlToMd,
		});
		// selector scoped to <main> → only "keep me" is passed to htmlToMarkdown
		expect(calls).toEqual(["keep me"]);
		const files = fs.readdirSync(
			path.join(env.cwd, ".pi", ".docs-cache", "hono"),
		);
		expect(files.length).toBe(1);
		expect(
			fs.readFileSync(
				path.join(env.cwd, ".pi", ".docs-cache", "hono", files[0]!),
				"utf8",
			),
		).toContain("converted: keep me");
	});

	test("cache hit within TTL returns cached path without refetch", async () => {
		const env = mkEnv();
		let fetchCalls = 0;
		const fetchFn: FetchFn = async (url) => {
			fetchCalls++;
			return { ok: true, status: 200, text: async () => "# first\n" };
		};
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		expect(fetchCalls).toBe(1);

		const second = await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		expect(fetchCalls).toBe(1);
		expect(second.stdout).toContain("cache hit");
	});

	test("--refresh forces re-fetch even when fresh", async () => {
		const env = mkEnv();
		let fetchCalls = 0;
		const fetchFn: FetchFn = async () => {
			fetchCalls++;
			return { ok: true, status: 200, text: async () => `# v${fetchCalls}\n` };
		};
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		await dispatch(["fetch", "@honcho-ai/sdk", "--refresh"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		expect(fetchCalls).toBe(2);
	});

	test("unknown lib refuses with register hint", async () => {
		const env = mkEnv();
		const result = await dispatch(["fetch", "not-registered"], {
			cwd: env.cwd,
			env: {},
			fetchFn: mockFetch({}),
			htmlToMarkdown: noopHtmlToMd,
		});
		expect(result.exit).toBe(1);
		expect(result.stderr).toContain("not in registry");
		expect(result.stderr).toContain("register");
	});

	test("non-2xx response surfaces HTTP error", async () => {
		const env = mkEnv();
		const fetchFn = mockFetch({
			"https://example.com/honcho-readme.md": {
				status: 500,
				body: "server error",
			},
		});
		const result = await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
		});
		expect(result.exit).toBe(2);
		expect(result.stderr).toContain("HTTP 500");
	});
});

// ---------------------------------------------------------------------------
// Dispatch — show
// ---------------------------------------------------------------------------

describe("show", () => {
	test("AC3: show prints cached body without stale warning when fresh", async () => {
		const env = mkEnv();
		const fetchFn = mockFetch({
			"https://example.com/honcho-readme.md": { body: "# H\n\nbody\n" },
		});
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		const result = await dispatch(["show", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("# H");
		expect(result.stdout).not.toContain("[stale");
	});

	test("AC3: show prints stale warning when cache >TTL", async () => {
		const env = mkEnv();
		const fetchFn = mockFetch({
			"https://example.com/honcho-readme.md": { body: "# old\n" },
		});
		const fetched = new Date("2026-04-01T10:00:00Z");
		await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fetched,
		});
		// Now query 10 days later
		const later = new Date("2026-04-11T10:00:00Z");
		const result = await dispatch(["show", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => later,
		});
		expect(result.exit).toBe(0);
		expect(result.stdout.split("\n")[0]).toContain("[stale");
		expect(result.stdout).toContain("refresh with:");
	});

	test("AC4: show --section=X prints only that section", async () => {
		const env = mkEnv();
		const fetchFn = mockFetch({
			"https://example.com/honcho-readme.md": {
				body: "# Title\n\nintro\n\n## Installation\n\nnpm install\n\n## Usage\n\nuse it\n",
			},
		});
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		await dispatch(["fetch", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
			now: () => fakeNow,
		});
		const result = await dispatch(
			["show", "@honcho-ai/sdk", "--section=Installation"],
			{
				cwd: env.cwd,
				env: {},
				fetchFn,
				htmlToMarkdown: noopHtmlToMd,
				now: () => fakeNow,
			},
		);
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("## Installation");
		expect(result.stdout).toContain("npm install");
		expect(result.stdout).not.toContain("use it");
	});

	test("show auto-fetches when no cache exists", async () => {
		const env = mkEnv();
		let fetchCalls = 0;
		const fetchFn: FetchFn = async () => {
			fetchCalls++;
			return { ok: true, status: 200, text: async () => "# auto-fetched\n" };
		};
		const result = await dispatch(["show", "@honcho-ai/sdk"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: noopHtmlToMd,
		});
		expect(fetchCalls).toBe(1);
		expect(result.stdout).toContain("# auto-fetched");
	});
});

// ---------------------------------------------------------------------------
// Dispatch — register
// ---------------------------------------------------------------------------

describe("register", () => {
	test("AC5: register without --i-approve prints preview, no registry change", async () => {
		const env = mkEnv();
		const before = loadRegistry(env.cwd);
		const result = await dispatch(
			["register", "new-lib", "https://new.example/docs"],
			{
				cwd: env.cwd,
				env: {},
				fetchFn: mockFetch({}),
				htmlToMarkdown: noopHtmlToMd,
			},
		);
		expect(result.exit).toBe(0);
		expect(result.stdout).toContain("DRAFT");
		expect(result.stdout).toContain("new-lib");
		expect(result.stdout).toContain("https://new.example/docs");
		const after = loadRegistry(env.cwd);
		expect(Object.keys(after)).toEqual(Object.keys(before));
	});

	test("AC5: register with --i-approve adds to registry and appends audit log", async () => {
		const env = mkEnv();
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		const result = await dispatch(
			[
				"register",
				"new-lib",
				"https://new.example/docs",
				"--type=html",
				"--selector=article",
				"--ttl-days=14",
				"--i-approve",
			],
			{
				cwd: env.cwd,
				env: {},
				fetchFn: mockFetch({}),
				htmlToMarkdown: noopHtmlToMd,
				now: () => fakeNow,
			},
		);
		expect(result.exit).toBe(0);
		const reg = loadRegistry(env.cwd);
		expect(reg["new-lib"]).toEqual({
			url: "https://new.example/docs",
			type: "html",
			selector: "article",
			ttl_days: 14,
			verified: false,
		});

		const logPath = path.join(env.cwd, ".pi", ".docs-registry-log.jsonl");
		expect(fs.existsSync(logPath)).toBe(true);
		const mode = fs.statSync(logPath).mode & 0o777;
		expect(mode).toBe(0o600);
		const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
		expect(entry.action).toBe("create");
		expect(entry.lib).toBe("new-lib");
		expect(entry.approver).toBe("luci");
		expect(entry.before).toBeNull();
	});

	test("register on existing lib logs action=update with before/after", async () => {
		const env = mkEnv();
		const fakeNow = new Date("2026-04-24T10:00:00Z");
		await dispatch(
			["register", "hono", "https://new-hono.example", "--i-approve"],
			{
				cwd: env.cwd,
				env: {},
				fetchFn: mockFetch({}),
				htmlToMarkdown: noopHtmlToMd,
				now: () => fakeNow,
			},
		);
		const logPath = path.join(env.cwd, ".pi", ".docs-registry-log.jsonl");
		const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
		expect(entry.action).toBe("update");
		expect(entry.before.url).toBe("https://hono.example/docs");
		expect(entry.after.url).toBe("https://new-hono.example");
	});

	test("invalid --type value refuses", async () => {
		const env = mkEnv();
		const result = await dispatch(
			["register", "x", "https://x", "--type=rtf", "--i-approve"],
			{
				cwd: env.cwd,
				env: {},
				fetchFn: mockFetch({}),
				htmlToMarkdown: noopHtmlToMd,
			},
		);
		expect(result.exit).toBe(1);
		expect(result.stderr).toContain("invalid --type");
	});
});

// ---------------------------------------------------------------------------
// Real turndown integration (no network)
// ---------------------------------------------------------------------------

describe("turndown integration (real HTML→MD, no network)", () => {
	test("real turndown converts scoped HTML into expected Markdown", async () => {
		const env = mkEnv();
		const html = `<html><body>
			<nav>skip</nav>
			<main>
				<h1>Title</h1>
				<p>Hello <a href="https://x.com">world</a>.</p>
				<pre><code>const x = 1;</code></pre>
			</main>
		</body></html>`;
		const fetchFn = mockFetch({ "https://hono.example/docs": { body: html } });
		const turndown = new TurndownService({
			headingStyle: "atx",
			codeBlockStyle: "fenced",
		});
		const realHtmlToMd: HtmlToMarkdown = (h) => turndown.turndown(h);

		await dispatch(["fetch", "hono"], {
			cwd: env.cwd,
			env: {},
			fetchFn,
			htmlToMarkdown: realHtmlToMd,
		});

		const files = fs.readdirSync(
			path.join(env.cwd, ".pi", ".docs-cache", "hono"),
		);
		expect(files.length).toBe(1);
		const content = fs.readFileSync(
			path.join(env.cwd, ".pi", ".docs-cache", "hono", files[0]!),
			"utf8",
		);
		expect(content).toContain("# Title"); // atx heading style
		expect(content).toContain("[world](https://x.com)");
		expect(content).toContain("const x = 1;");
		expect(content).not.toContain("<nav>"); // nav was scoped out by <main> selector
	});
});

// ---------------------------------------------------------------------------
// Gitignore / registry sanity — run against the real project registry
// ---------------------------------------------------------------------------

describe("project registry + gitignore", () => {
	test("seeded registry.json includes all 11 libraries from spec §2", () => {
		const repoRoot = path.resolve(import.meta.dir, "../../..");
		const reg = loadRegistry(repoRoot);
		const expected = [
			"@linear/sdk",
			"@honcho-ai/sdk",
			"hono",
			"better-auth",
			"drizzle-orm",
			"@libsql/client",
			"@cloudflare/workers-types",
			"wrangler",
			"@tanstack/start",
			"@tanstack/react-query",
			"zod",
		];
		for (const lib of expected) {
			expect(reg[lib]).toBeDefined();
		}
	});

	test("AC8: .omp/.docs-cache/ and .pi/.docs-registry-log.jsonl are gitignored", () => {
		const repoRoot = path.resolve(import.meta.dir, "../../..");
		const gi = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
		expect(gi).toMatch(/\.pi\/\.docs-cache\//);
		expect(gi).toMatch(/\.pi\/\.docs-registry-log\.jsonl/);
	});
});

// ---------------------------------------------------------------------------
// sanitizeLib — path-traversal rejection + regression
// ---------------------------------------------------------------------------

describe("sanitizeLib", () => {
	test("throws on '..'", () => {
		expect(() => sanitizeLib("..")).toThrow("path-traversal rejected");
	});

	test("throws on '../evil'", () => {
		expect(() => sanitizeLib("../evil")).toThrow("path-traversal rejected");
	});

	test("throws on embedded null byte", () => {
		expect(() => sanitizeLib("a\0b")).toThrow("path-traversal rejected");
	});

	test("regression: @honcho-ai/sdk → @honcho-ai-sdk", () => {
		expect(sanitizeLib("@honcho-ai/sdk")).toBe("@honcho-ai-sdk");
	});
});
