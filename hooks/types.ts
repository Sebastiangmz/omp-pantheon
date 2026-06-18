export type HookAPI = {
	on: (eventName: string, handler: (event: any, ctx: any) => unknown) => void;
	appendEntry: (...args: any[]) => void | Promise<void>;
	logger: {
		debug: (...args: any[]) => void;
		info: (...args: any[]) => void;
		warn: (...args: any[]) => void;
		error: (...args: any[]) => void;
	};
};
