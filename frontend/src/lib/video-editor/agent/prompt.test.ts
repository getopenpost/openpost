import { describe, expect, it } from 'vitest';
import { parsePlan, buildSystemPrompt } from './prompt';
import { listEditorTools } from './registry';

describe('agent prompt', () => {
	it('builds a catalog covering every registered tool', () => {
		const prompt = buildSystemPrompt();
		for (const tool of listEditorTools()) {
			expect(prompt).toContain(tool.name);
		}
	});

	it('extracts a JSON object from fenced model output', () => {
		const raw = '```json\n{ \"reply\": \"Hello\", \"steps\": [] }\n```';
		const parsed = parsePlan(raw);
		expect(parsed.valid).toBe(true);
		expect(parsed.reply).toBe('Hello');
		expect(parsed.steps).toEqual([]);
	});

	it('marks invalid JSON as not valid for retry', () => {
		const parsed = parsePlan('sorry, I cannot');
		expect(parsed.valid).toBe(false);
	});

	it('parses steps with missing args as empty', () => {
		const raw = JSON.stringify({ reply: 'hi', steps: [{ tool: 'find_clips' }] });
		const parsed = parsePlan(raw);
		expect(parsed.valid).toBe(true);
		expect(parsed.steps).toEqual([{ tool: 'find_clips', args: {} }]);
	});
});
