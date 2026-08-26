export interface JsonSchema {
	type: 'object';
	properties: Record<string, unknown>;
	required?: string[];
	additionalProperties?: boolean;
}

export interface ToolResult {
	ok: boolean;
	message: string;
	data?: unknown;
}

export type ToolValidation =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; error: string };

export interface EditorAgentTool {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly inputSchema: JsonSchema;
	readonly readOnly: boolean;
	readonly destructive: boolean;
	readonly handoff: boolean;
	validate: (args: unknown) => ToolValidation;
	summarize: (args: Record<string, unknown>) => string;
	execute: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}
