import { describe, expect, it } from 'vitest';
import { parseLlmWorkerRequest } from './worker-protocol';

describe('gemma worker request validation', () => {
	it('rejects malformed generate requests', () => {
		const malformed = [
			{
				type: 'generate',
				id: Number.NaN,
				messages: [],
				maxTokens: 100,
				temperature: 0,
				topP: 0.9
			},
			{
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: Number.POSITIVE_INFINITY,
				temperature: 0,
				topP: 0.9
			},
			{
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: 0,
				temperature: 0,
				topP: 0.9
			},
			{
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: 100,
				temperature: Number.NaN,
				topP: 0.9
			},
			{
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: 100,
				temperature: 0,
				topP: 2
			},
			{
				type: 'generate',
				id: 1,
				messages: [{ role: 'user', content: 123 }],
				maxTokens: 100,
				temperature: 0,
				topP: 0.9
			}
		];
		for (const request of malformed) expect(parseLlmWorkerRequest(request)).toBeNull();
	});
});
