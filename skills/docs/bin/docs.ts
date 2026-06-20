#!/usr/bin/env -S bun run
/**
 * docs — Propose-review-apply flow for BMad artifacts.
 *
 * SpecSafe slice: SPEC-20260424-004 — linear-steward-docs
 *
 * Steward proposes diffs via `docs propose`; human (Luci) reviews and applies
 * with `docs apply --i-approve`. Commits carry structured trailers.
 *
 * Usage:
 *   bun run .omp/skills/docs/bin/docs.ts propose <path> --rationale=<r>
 *   bun run .omp/skills/docs/bin/docs.ts list
 *   bun run .omp/skills/docs/bin/docs.ts show <id>
 *   bun run .omp/skills/docs/bin/docs.ts apply <id> [--i-approve]
 *   bun run .omp/skills/docs/bin/docs.ts discard <id>
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readStateFileOrNull, statePathFor } from "./_specsafe-state.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DispatchResult = {
	stdout: string;
	stderr: string;
	exit: number;
};

export type GitRunnerResult = {
	stdout: string;
	stderr: string;
	exit: number;
};

export type DispatchOpts = {
	cwd: string;
	stdin?: NodeJS.ReadableStream;
	gitRunner?: (args: string[], opts: { cwd: string }) => GitRunnerResult;
	now?: () => Date;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_PREFIXES = ["docs/", "specs/", "specs/briefs/"];
const SCOPE_ERROR =
	"docs skill is scoped to BMad artifacts (paths must start with docs/, specs/, or specs/briefs/)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDraftsDir(cwd: string): string {
	return path.join(cwd, ".pi", ".doc-drafts");
}

function ensureDraftsDir(cwd: string): void {
	fs.mkdirSync(getDraftsDir(cwd), { recursive: true });
}

function slugify(filePath: string): string {
	// Use basename only, lowercase, replace non-alphanumeric with -, trim edge dashes
	const base = path.basename(filePath);
	return base
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function isAllowedPath(filePath: string): boolean {
	return ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

function isValidUnifiedDiff(diff: string): boolean {
	return diff.includes("--- ") && diff.includes("+++ ");
}

/** Read stdin to string */
async function readStdin(stdin: NodeJS.ReadableStream): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Parse the header of a patch file and extract metadata */
type PatchHeader = {
	rationale: string;
	proposedAt: string;
	target: string;
};

function parsePatchHeader(content: string): PatchHeader | null {
	const lines = content.split("\n");
	let rationale = "";
	let proposedAt = "";
	let target = "";

	for (const line of lines) {
		if (line.startsWith("# Rationale: ")) {
			rationale = line.slice("# Rationale: ".length);
		} else if (line.startsWith("# Proposed at: ")) {
			proposedAt = line.slice("# Proposed at: ".length);
		} else if (line.startsWith("# Target: ")) {
			target = line.slice("# Target: ".length);
		}
	}

	if (!rationale || !proposedAt || !target) return null;
	return { rationale, proposedAt, target };
}

/** List all pending draft files (excludes .discarded/ and .applied/ subdirs) */
function listPendingDrafts(cwd: string): Array<{
	id: string;
	filePath: string;
	content: string;
	header: PatchHeader;
}> {
	const draftsDir = getDraftsDir(cwd);
	if (!fs.existsSync(draftsDir)) return [];

	const files = fs.readdirSync(draftsDir).filter((f) => f.endsWith(".patch"));
	const result = [];

	for (const file of files) {
		const filePath = path.join(draftsDir, file);
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) continue;

		const content = fs.readFileSync(filePath, "utf8");
		const header = parsePatchHeader(content);
		if (!header) continue;

		const id = file.replace(".patch", "");
		result.push({ id, filePath, content, header });
	}

	// Sort by filename (= by timestamp)
	result.sort((a, b) => a.id.localeCompare(b.id));
	return result;
}

/** Find a specific draft by ID */
function findDraft(
	cwd: string,
	id: string,
): { filePath: string; content: string; header: PatchHeader } | null {
	const filePath = path.join(getDraftsDir(cwd), `${id}.patch`);
	if (!fs.existsSync(filePath)) return null;

	const content = fs.readFileSync(filePath, "utf8");
	const header = parsePatchHeader(content);
	if (!header) return null;

	return { filePath, content, header };
}

/** Extract just the diff body (lines after the last # comment header) */
function extractDiffBody(content: string): string {
	const lines = content.split("\n");
	let firstDiffLine = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (!line.startsWith("#") && line.trim() !== "") {
			firstDiffLine = i;
			break;
		}
	}
	if (firstDiffLine === -1) return content;
	return lines.slice(firstDiffLine).join("\n");
}

/** Real git runner using Bun.spawnSync */
function realGitRunner(args: string[], opts: { cwd: string }): GitRunnerResult {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: opts.cwd,
		env: process.env as Record<string, string>,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "inherit",
	});
	return {
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
		exit: result.exitCode ?? 0,
	};
}

/** Run git apply via a temp file (avoids stdin complications) */
function runGitApplyFile(
	patchContent: string,
	cwd: string,
	git: DispatchOpts["gitRunner"],
): GitRunnerResult {
	const runner = git ?? realGitRunner;
	// Write diff body to a temp file
	const tmpFile = path.join(os.tmpdir(), `docs-apply-${Date.now()}.patch`);
	const diffBody = extractDiffBody(patchContent);
	fs.writeFileSync(tmpFile, diffBody, { mode: 0o600 });
	try {
		return runner(["apply", "--index", tmpFile], { cwd });
	} finally {
		try {
			fs.unlinkSync(tmpFile);
		} catch {}
	}
}

import * as os from "node:os";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdPropose(
	filePath: string,
	rationale: string,
	opts: DispatchOpts,
): Promise<DispatchResult> {
	// Scope check
	if (!isAllowedPath(filePath)) {
		return { stdout: "", stderr: SCOPE_ERROR, exit: 1 };
	}

	// Read diff from stdin
	const stdin = opts.stdin ?? (process.stdin as NodeJS.ReadableStream);
	let diffBody: string;
	try {
		diffBody = await readStdin(stdin);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { stdout: "", stderr: `error reading stdin: ${msg}`, exit: 1 };
	}

	// Validate diff
	if (!diffBody.trim()) {
		return {
			stdout: "",
			stderr: "invalid unified diff: stdin was empty",
			exit: 1,
		};
	}
	if (!isValidUnifiedDiff(diffBody)) {
		return {
			stdout: "",
			stderr: "invalid unified diff: must contain --- and +++ header lines",
			exit: 1,
		};
	}

	// Build patch content
	const now = (opts.now ?? (() => new Date()))();
	// Strip milliseconds to match spec format: 2026-04-24T14:02:11Z (not .000Z)
	const timestamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
	const slug = slugify(filePath);
	const draftId = `${timestamp}-${slug}`;

	const patchContent = `# Rationale: ${rationale}\n# Proposed at: ${timestamp}\n# Target: ${filePath}\n${diffBody}`;

	// Write file
	ensureDraftsDir(opts.cwd);
	const patchPath = path.join(getDraftsDir(opts.cwd), `${draftId}.patch`);
	fs.writeFileSync(patchPath, patchContent, { mode: 0o600 });
	// Re-apply mode (in case umask overrode it)
	fs.chmodSync(patchPath, 0o600);

	return { stdout: draftId, stderr: "", exit: 0 };
}

async function cmdList(opts: DispatchOpts): Promise<DispatchResult> {
	const drafts = listPendingDrafts(opts.cwd);

	if (drafts.length === 0) {
		return { stdout: "no pending drafts", stderr: "", exit: 0 };
	}

	const ID_W = 44;
	const TARGET_W = 28;
	const DATE_W = 22;
	const RATIONALE_W = 62;

	const header = [
		"id".padEnd(ID_W),
		"target".padEnd(TARGET_W),
		"proposed_at".padEnd(DATE_W),
		"rationale",
	].join(" | ");
	const sep = "-".repeat(header.length);

	const rows = drafts.map((d) => {
		const rat =
			d.header.rationale.length > 60
				? `${d.header.rationale.slice(0, 60)}...`
				: d.header.rationale;
		return [
			d.id.padEnd(ID_W),
			d.header.target.padEnd(TARGET_W),
			d.header.proposedAt.padEnd(DATE_W),
			rat,
		].join(" | ");
	});

	const lines = [header, sep, ...rows];
	return { stdout: lines.join("\n"), stderr: "", exit: 0 };
}

async function cmdShow(
	id: string,
	opts: DispatchOpts,
): Promise<DispatchResult> {
	const draft = findDraft(opts.cwd, id);
	if (!draft) {
		return { stdout: "", stderr: `no draft found with id: ${id}`, exit: 1 };
	}
	return { stdout: draft.content, stderr: "", exit: 0 };
}

async function cmdApply(
	id: string,
	approve: boolean,
	opts: DispatchOpts,
): Promise<DispatchResult> {
	const draft = findDraft(opts.cwd, id);
	if (!draft) {
		return { stdout: "", stderr: `no draft found with id: ${id}`, exit: 1 };
	}

	// Dry-run (no --i-approve)
	if (!approve) {
		const preview = [
			draft.content,
			"",
			`would apply to: ${draft.header.target}`,
			"NOT YET APPLIED (rerun with --i-approve)",
		].join("\n");
		return { stdout: preview, stderr: "", exit: 0 };
	}

	// --- Approved path ---
	const git = opts.gitRunner ?? realGitRunner;

	// 1. Verify clean tree
	const statusResult = git(["status", "--porcelain"], { cwd: opts.cwd });
	if (statusResult.exit !== 0 || statusResult.stdout.trim() !== "") {
		return {
			stdout: "",
			stderr: "working tree must be clean before docs apply",
			exit: 1,
		};
	}

	// 2. Apply patch via temp file
	const applyResult = runGitApplyFile(draft.content, opts.cwd, git);
	if (applyResult.exit !== 0) {
		return {
			stdout: "",
			stderr: `git apply failed:\n${applyResult.stderr || applyResult.stdout}`,
			exit: 1,
		};
	}

	// 3. Read SpecSafe state for open slice
	const statePath = statePathFor(opts.cwd);
	const state = readStateFileOrNull(statePath);
	const sliceId = state?.currentSlice?.id ?? null;

	// 4. Build commit message
	const subject = `docs: ${draft.header.rationale}`;
	const trailers = [
		"Proposed-By: steward",
		"Approved-By: luci",
		...(sliceId ? [`Spec-Slice: ${sliceId}`] : []),
		`Rationale-From: ${id}`,
	].join("\n");

	const commitMessage = [
		subject,
		"",
		draft.header.rationale,
		"",
		trailers,
	].join("\n");

	// 5. Commit
	const commitResult = git(["commit", "-m", commitMessage], { cwd: opts.cwd });
	if (commitResult.exit !== 0) {
		return {
			stdout: "",
			stderr: `git commit failed:\n${commitResult.stderr || commitResult.stdout}`,
			exit: 1,
		};
	}

	// 6. Move to .applied/
	const appliedDir = path.join(getDraftsDir(opts.cwd), ".applied");
	fs.mkdirSync(appliedDir, { recursive: true });
	fs.renameSync(draft.filePath, path.join(appliedDir, `${id}.patch`));

	return { stdout: `applied: ${id}`, stderr: "", exit: 0 };
}

async function cmdDiscard(
	id: string,
	opts: DispatchOpts,
): Promise<DispatchResult> {
	const draft = findDraft(opts.cwd, id);
	if (!draft) {
		return { stdout: "", stderr: `no draft found with id: ${id}`, exit: 1 };
	}

	const discardedDir = path.join(getDraftsDir(opts.cwd), ".discarded");
	fs.mkdirSync(discardedDir, { recursive: true });
	fs.renameSync(draft.filePath, path.join(discardedDir, `${id}.patch`));

	return { stdout: `discarded: ${id}`, stderr: "", exit: 0 };
}

// ---------------------------------------------------------------------------
// Main dispatch function (pure — no process.* calls except CLI entry point)
// ---------------------------------------------------------------------------

const USAGE = `usage: docs <command> [args]

Commands:
  propose <path> --rationale=<r>    propose a unified diff (read from stdin)
  list                              list pending drafts
  show <id>                         show diff + rationale for a draft
  apply <id> [--i-approve]          preview (or apply) a draft
  discard <id>                      move draft to .discarded/`;

export async function dispatch(
	argv: string[],
	opts: DispatchOpts,
): Promise<DispatchResult> {
	const [command, ...rest] = argv;

	switch (command) {
		case "propose": {
			const filePath = rest[0];
			if (!filePath) {
				return {
					stdout: "",
					stderr: `usage: docs propose <path> --rationale=<r>\n\n${USAGE}`,
					exit: 1,
				};
			}
			let rationale = "";
			for (const arg of rest.slice(1)) {
				const m = arg.match(/^--rationale=(.+)$/s);
				if (m?.[1]) rationale = m[1];
			}
			if (!rationale) {
				return {
					stdout: "",
					stderr: `--rationale is required\n\n${USAGE}`,
					exit: 1,
				};
			}
			return cmdPropose(filePath, rationale, opts);
		}

		case "list":
			return cmdList(opts);

		case "show": {
			const id = rest[0];
			if (!id) {
				return {
					stdout: "",
					stderr: `usage: docs show <id>\n\n${USAGE}`,
					exit: 1,
				};
			}
			return cmdShow(id, opts);
		}

		case "apply": {
			const id = rest[0];
			if (!id) {
				return {
					stdout: "",
					stderr: `usage: docs apply <id> [--i-approve]\n\n${USAGE}`,
					exit: 1,
				};
			}
			const approve = rest.includes("--i-approve");
			return cmdApply(id, approve, opts);
		}

		case "discard": {
			const id = rest[0];
			if (!id) {
				return {
					stdout: "",
					stderr: `usage: docs discard <id>\n\n${USAGE}`,
					exit: 1,
				};
			}
			return cmdDiscard(id, opts);
		}

		default:
			return {
				stdout: "",
				stderr: `unknown command: ${command ?? "(none)"}\n\n${USAGE}`,
				exit: 1,
			};
	}
}

// ---------------------------------------------------------------------------
// CLI entry point — thin wrapper only
// ---------------------------------------------------------------------------

if (import.meta.main) {
	const result = await dispatch(process.argv.slice(2), {
		cwd: process.cwd(),
		stdin: process.stdin as NodeJS.ReadableStream,
	});

	if (result.stdout) console.log(result.stdout);
	if (result.stderr) console.error(result.stderr);
	process.exit(result.exit);
}
