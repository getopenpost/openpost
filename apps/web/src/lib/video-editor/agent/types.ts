export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export interface JsonObject {
	[key: string]: JsonValue;
}

export interface JsonSchemaProperty {
	type?: string;
	enum?: string[];
	description?: string;
	items?: JsonSchemaProperty;
	minimum?: number;
	maximum?: number;
}

export interface JsonSchema {
	type: 'object';
	properties: Record<string, JsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean;
}

export interface ToolResult {
	ok: boolean;
	message: string;
	data?: JsonValue;
}

export type ToolValidation = { ok: true; value: JsonObject } | { ok: false; error: string };

export interface EditorAgentTool {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly inputSchema: JsonSchema;
	readonly readOnly: boolean;
	readonly destructive: boolean;
	readonly handoff: boolean;
	validate: (args: JsonValue) => ToolValidation;
	summarize: (args: JsonObject) => string;
	execute: (args: JsonObject) => Promise<ToolResult> | ToolResult;
}
