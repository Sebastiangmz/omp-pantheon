#!/usr/bin/env -S bun run
/**
 * bootstrap — initialize a foreign project to use the pi-seshat system.
 *
 * SpecSafe slice: SPEC-20260427-016 — project-bootstrap-skill
 *
 * Usage:
 *   bun run .omp/skills/bootstrap/bin/bootstrap.ts                # dry-run
 *   bun run .omp/skills/bootstrap/bin/bootstrap.ts --i-approve    # apply
 *   bun run .omp/skills/bootstrap/bin/bootstrap.ts --i-approve --force-symlink
 *   bun run .omp/skills/bootstrap/bin/bootstrap.ts --with-evalfly          # preview evals/ template copy
 *   bun run .omp/skills/bootstrap/bin/bootstrap.ts --i-approve --with-evalfly
 *
 * Exit codes:
 *   0  success or successful dry-run (including idempotent no-op)
 *   1  refuse-condition (pi-seshat self, .omp conflict, write failure)
 *   2  invalid flag or argument
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// bin/bootstrap.ts → skills/bootstrap/bin → repo root is 3 levels up.
const PI_SESHAT_ROOT = path.resolve(__dirname, "..", "..", "..");
const OMP_SOURCE = PI_SESHAT_ROOT;
const TEMPLATES_DIR = path.resolve(__dirname, "..", "templates");

const DIRS = [".pi", "specs", "specs/briefs", "specs/archive"];

const GITIGNORE_PATTERNS = [
	".pi/.specsafe-state.json",
	".pi/.specsafe-state.json.corrupt-*",
	".pi/.push-log.jsonl",
	".pi/.linear-log.jsonl",
	".pi/.github-log.jsonl",
	".pi/.docs-registry-log.jsonl",
	".pi/.doc-drafts/",
	".pi/.docs-cache/",
	".pi/.bootstrap-log.jsonl",
];

type Opts = {
	iApprove: boolean;
	forceSymlink: boolean;
	withEvalfly: boolean;
};

function fail(message: string, code: number): never {
	process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
	process.exit(code);
}

function parseArgs(argv: string[]): Opts {
	const opts: Opts = {
		iApprove: false,
		forceSymlink: false,
		withEvalfly: false,
	};
	for (const arg of argv) {
		if (arg === "--i-approve") opts.iApprove = true;
		else if (arg === "--force-symlink") opts.forceSymlink = true;
		else if (arg === "--with-evalfly") opts.withEvalfly = true;
		else fail(`error: unknown flag: ${arg}`, 2);
	}
	return opts;
}

function safeLstat(p: string): fs.Stats | null {
	try {
		return fs.lstatSync(p);
	} catch {
		return null;
	}
}

function readTemplate(name: string): string {
	return fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf-8");
}

function fillTemplate(s: string, vars: Record<string, string>): string {
	let out = s;
	for (const [k, v] of Object.entries(vars)) {
		out = out.replaceAll(`{{${k}}}`, v);
	}
	return out;
}

type SymlinkAction = "create" | "force-replace" | "skip" | "conflict";

type Plan = {
	dirsMissing: string[];
	symlinkAction: SymlinkAction;
	agentsExists: boolean;
	claudeExists: boolean;
	gitignoreMissing: string[];
	evalsExists: boolean;
	withEvalfly: boolean;
	hasMutations: boolean;
};

function computePlan(cwd: string, opts: Opts): Plan {
	const dirsMissing = DIRS.filter((d) => !fs.existsSync(path.join(cwd, d)));

	const ompPath = path.join(cwd, ".omp");
	const ompStat = safeLstat(ompPath);
	let symlinkAction: SymlinkAction;
	if (!ompStat) {
		symlinkAction = "create";
	} else if (ompStat.isSymbolicLink()) {
		let real: string | null = null;
		try {
			real = fs.realpathSync(ompPath);
		} catch {
			real = null;
		}
		if (real === OMP_SOURCE) symlinkAction = "skip";
		else symlinkAction = opts.forceSymlink ? "force-replace" : "conflict";
	} else {
		symlinkAction = opts.forceSymlink ? "force-replace" : "conflict";
	}

	const agentsExists = fs.existsSync(path.join(cwd, "AGENTS.md"));
	const claudeExists = fs.existsSync(path.join(cwd, "CLAUDE.md"));
	const evalsExists = fs.existsSync(path.join(cwd, "evals"));

	let existingGitignore = "";
	try {
		existingGitignore = fs.readFileSync(path.join(cwd, ".gitignore"), "utf-8");
	} catch {
		/* missing is fine */
	}
	const existingLines = new Set(existingGitignore.split(/\r?\n/));
	const gitignoreMissing = GITIGNORE_PATTERNS.filter(
		(p) => !existingLines.has(p),
	);

	const hasMutations =
		dirsMissing.length > 0 ||
		symlinkAction === "create" ||
		symlinkAction === "force-replace" ||
		!agentsExists ||
		!claudeExists ||
		(opts.withEvalfly && !evalsExists) ||
		gitignoreMissing.length > 0;

	return {
		dirsMissing,
		symlinkAction,
		agentsExists,
		claudeExists,
		evalsExists,
		withEvalfly: opts.withEvalfly,
		gitignoreMissing,
		hasMutations,
	};
}

function detectPiSeshatSelf(cwd: string): boolean {
	if (path.resolve(cwd) === PI_SESHAT_ROOT) return true;
	// Defense-in-depth: a regular config directory holding a real bootstrap skill
	// means we're inside a clone of the source bundle itself. A symlinked `.omp`
	// points at this bundle from an already-bootstrapped project and must not be
	// classified as self.
	const nativeSentinel = path.join(cwd, "skills", "bootstrap", "SKILL.md");
	const ompPath = path.join(cwd, ".omp");
	const ompStat = safeLstat(ompPath);
	const ompSentinel =
		ompStat && !ompStat.isSymbolicLink() && ompStat.isDirectory()
			? path.join(ompPath, "skills", "bootstrap", "SKILL.md")
			: null;
	return (
		fs.existsSync(nativeSentinel) ||
		(ompSentinel ? fs.existsSync(ompSentinel) : false)
	);
}

function previewMode(cwd: string, plan: Plan, out: NodeJS.WriteStream): number {
	if (!plan.hasMutations) {
		out.write("nothing to do — project already bootstrapped\n");
		return 0;
	}
	if (plan.dirsMissing.length > 0) {
		out.write(`would create directories: ${plan.dirsMissing.join(", ")}\n`);
	}
	if (plan.symlinkAction === "create") {
		out.write(`would symlink .omp → ${OMP_SOURCE}\n`);
	} else if (plan.symlinkAction === "force-replace") {
		out.write(
			`would symlink .omp → ${OMP_SOURCE} (replacing existing directory)\n`,
		);
	}
	if (!plan.agentsExists) out.write("would write AGENTS.md\n");
	if (!plan.claudeExists) out.write("would write CLAUDE.md\n");
	if (plan.withEvalfly) {
		if (plan.evalsExists) {
			out.write("evals exists — skipping EvalFly template\n");
		} else {
			out.write("would copy EvalFly evals template\n");
		}
	}
	if (plan.gitignoreMissing.length > 0) {
		out.write(
			`would update .gitignore (${plan.gitignoreMissing.length} patterns)\n`,
		);
	}
	out.write("would write audit log entry\n");
	return 0;
}

function applyMode(
	cwd: string,
	plan: Plan,
	opts: Opts,
	out: NodeJS.WriteStream,
): number {
	const applied: string[] = [];

	// (a) directories
	if (plan.dirsMissing.length > 0) {
		for (const d of plan.dirsMissing) {
			fs.mkdirSync(path.join(cwd, d), { recursive: true });
		}
		out.write(`created directories: ${plan.dirsMissing.join(", ")}\n`);
		applied.push("directories");
	}

	// (b) symlink
	const ompPath = path.join(cwd, ".omp");
	if (plan.symlinkAction === "create") {
		fs.symlinkSync(OMP_SOURCE, ompPath);
		out.write(`symlinked .omp → ${OMP_SOURCE}\n`);
		applied.push("symlink");
	} else if (plan.symlinkAction === "force-replace") {
		fs.rmSync(ompPath, { recursive: true, force: true });
		fs.symlinkSync(OMP_SOURCE, ompPath);
		out.write(`symlinked .omp → ${OMP_SOURCE} (replaced existing)\n`);
		applied.push("symlink-forced");
	}

	// Template substitution vars
	const projectName = path.basename(cwd);
	const vars = {
		PROJECT_NAME: projectName,
	};

	// (c) AGENTS.md
	const agentsPath = path.join(cwd, "AGENTS.md");
	if (plan.agentsExists) {
		out.write("AGENTS.md exists — skipping\n");
	} else {
		const tpl = readTemplate("AGENTS.md");
		fs.writeFileSync(agentsPath, fillTemplate(tpl, vars));
		out.write("wrote AGENTS.md\n");
		applied.push("AGENTS.md");
	}

	// (d) CLAUDE.md
	const claudePath = path.join(cwd, "CLAUDE.md");
	if (plan.claudeExists) {
		out.write("CLAUDE.md exists — skipping\n");
	} else {
		const tpl = readTemplate("CLAUDE.md");
		fs.writeFileSync(claudePath, fillTemplate(tpl, vars));
		out.write("wrote CLAUDE.md\n");
		applied.push("CLAUDE.md");
	}

	// (e) optional EvalFly template
	const evalsPath = path.join(cwd, "evals");
	if (opts.withEvalfly) {
		if (plan.evalsExists) {
			out.write("evals exists — skipping EvalFly template\n");
		} else {
			fs.cpSync(
				path.join(PI_SESHAT_ROOT, "skills", "evalfly", "templates", "evals"),
				evalsPath,
				{ recursive: true, errorOnExist: true, force: false },
			);
			out.write("copied EvalFly evals template\n");
			applied.push("evals");
		}
	}

	// (f) .gitignore
	if (plan.gitignoreMissing.length > 0) {
		const giPath = path.join(cwd, ".gitignore");
		let existing = "";
		try {
			existing = fs.readFileSync(giPath, "utf-8");
		} catch {
			/* missing */
		}
		let content = existing;
		if (content.length > 0 && !content.endsWith("\n")) content += "\n";
		content += `${plan.gitignoreMissing.join("\n")}\n`;
		fs.writeFileSync(giPath, content);
		out.write(
			`updated .gitignore (${plan.gitignoreMissing.length} patterns)\n`,
		);
		applied.push(".gitignore");
	}

	// (f) audit log — always append on apply
	const logPath = path.join(cwd, ".pi", ".bootstrap-log.jsonl");
	fs.mkdirSync(path.dirname(logPath), { recursive: true });
	const entry = `${JSON.stringify({
		ts: new Date().toISOString(),
		action: "bootstrap",
		cwd,
		piSeshatRoot: PI_SESHAT_ROOT,
		applied: applied.length > 0 ? applied : ["audit-log-only"],
		approver: "luci",
	})}\n`;
	if (!fs.existsSync(logPath)) {
		fs.writeFileSync(logPath, entry, { mode: 0o600 });
	} else {
		fs.appendFileSync(logPath, entry);
	}
	fs.chmodSync(logPath, 0o600);
	out.write("wrote audit log entry\n");

	return 0;
}

function main(argv: string[]): number {
	const opts = parseArgs(argv);
	const cwd = path.resolve(process.cwd());

	if (detectPiSeshatSelf(cwd)) {
		fail(
			"error: Refusing to bootstrap pi-seshat self: cwd is the source repo",
			1,
		);
	}

	const plan = computePlan(cwd, opts);

	if (plan.symlinkAction === "conflict") {
		fail(
			"error: .omp conflict — <cwd>/.omp exists as a regular directory; pass --force-symlink to replace",
			1,
		);
	}

	if (!opts.iApprove) {
		return previewMode(cwd, plan, process.stdout);
	}
	return applyMode(cwd, plan, opts, process.stdout);
}

process.exit(main(process.argv.slice(2)));
