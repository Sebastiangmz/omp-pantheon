import type {
	AgentToolResult,
	CustomToolContext,
	ExtensionAPI,
} from "@oh-my-pi/pi-coding-agent";

import honchoToolFactory from "../../tools/honcho/index";

type ExtensionToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];
type HonchoFactoryAPI = Parameters<typeof honchoToolFactory>[0];

type HonchoToolDefinition = {
	name: string;
	label: string;
	description: string;
	parameters: ExtensionToolDefinition["parameters"];
	execute: (
		toolCallId: string,
		params: unknown,
		onUpdate: unknown,
		ctx: CustomToolContext,
		signal?: AbortSignal,
	) => Promise<AgentToolResult<unknown>>;
};

function isHonchoTool(value: unknown): value is HonchoToolDefinition {
	if (!value || typeof value !== "object") return false;
	return (
		"name" in value &&
		typeof value.name === "string" &&
		"label" in value &&
		typeof value.label === "string" &&
		"description" in value &&
		typeof value.description === "string" &&
		"parameters" in value &&
		"execute" in value &&
		typeof value.execute === "function"
	);
}

function normalizeHonchoTools(value: unknown): HonchoToolDefinition[] {
	const candidates = Array.isArray(value) ? value : [value];
	const tools: HonchoToolDefinition[] = [];
	for (const candidate of candidates) {
		if (!isHonchoTool(candidate)) {
			throw new Error("Honcho tool factory returned an invalid tool definition");
		}
		tools.push(candidate);
	}
	return tools;
}

export async function registerHonchoTools(pi: ExtensionAPI): Promise<void> {
	// The Honcho factory only reads the shared `typebox` and package-export
	// surfaces that ExtensionAPI also exposes; this adapts two compatible host APIs.
	const factoryApi = pi as unknown as HonchoFactoryAPI;
	const tools = normalizeHonchoTools(await honchoToolFactory(factoryApi));
	for (const tool of tools) {
		pi.registerTool({
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: tool.parameters,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				// Extension tools receive `(signal, onUpdate, ctx)` while the custom-tool
				// loader contract uses `(onUpdate, ctx, signal)`.
				const customToolContext = ctx as unknown as CustomToolContext;
				return tool.execute(toolCallId, params, onUpdate, customToolContext, signal);
			},
		});
	}
}
