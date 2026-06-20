export type HookEvent = {
	toolName?: string;
	input?: unknown;
	attempt?: unknown;
	maxAttempts?: unknown;
	delayMs?: unknown;
	errorMessage?: string;
	success?: unknown;
	isError?: boolean;
	content?: unknown;
	finalError?: string;
	[key: string]: unknown;
};

export type HookContext = {
	cwd: string;
	hasUI?: boolean;
	ui?: {
		setStatus(key: string, value: string): void;
		notify(message: string, level: "info" | "warning" | "error"): void;
	};
	model?: { provider: string; id: string };
	sessionManager: {
		getSessionId(): string;
		getEntries(): unknown[];
	};
	[key: string]: unknown;
};

export type HookAPI = {
	on: (
		eventName: string,
		handler: (event: HookEvent, ctx: HookContext) => unknown,
	) => void;
	appendEntry: (...args: unknown[]) => void | Promise<void>;
	logger: {
		debug: (...args: unknown[]) => void;
		info: (...args: unknown[]) => void;
		warn: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
};
