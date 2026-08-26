import { EDITOR_TOOLS } from './tools/definitions';
import type { EditorAgentTool, JsonSchema } from './types';

const TOOLS_BY_NAME = new Map(EDITOR_TOOLS.map((tool) => [tool.name, tool]));

export function listEditorTools(): readonly EditorAgentTool[] {
	return EDITOR_TOOLS;
}

export function getEditorTool(name: string): EditorAgentTool | undefined {
	return TOOLS_BY_NAME.get(name);
}

function argHint(schema: JsonSchema): string {
	const entries = Object.entries(schema.properties);
	if (entries.length === 0) return '{}';
	const parts = entries.map(([key, raw]) => {
		const value = raw as { type?: string; enum?: string[] };
		const required = schema.required?.includes(key) ?? false;
		const type = value.enum
			? value.enum.map((option) => `"${option}"`).join('|')
			: (value.type ?? 'any');
		return `${key}${required ? '' : '?'}: ${type}`;
	});
	return `{ ${parts.join(', ')} }`;
}

export function buildToolCatalog(): string {
	return listEditorTools()
		.map((tool) => {
			const tag = tool.readOnly ? ' [read-only]' : tool.handoff ? ' [opens review]' : '';
			return `- ${tool.name}${tag}: ${tool.description}\n  args: ${argHint(tool.inputSchema)}`;
		})
		.join('\n');
}
