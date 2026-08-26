import { describe, expect, it } from 'vitest';
import { isValidRequest } from './gemma-worker';

describe('gemma worker request validation', () => {
	it('rejects malformed generate requests', () => {
		expect(
			isValidRequest({
				type: 'generate',
				id: NaN,
				messages: [],
				maxTokens: 100,
				temperature: 0,
				topP: 0.9
			})
		).toBe(false);
		expect(
			isValidRequest({
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: Infinity,
				temperature: 0,
				topP: 0.9
			})
		).toBe(false);
		expect(
			isValidRequest({
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: 0,
				temperature: 0,
				topP: 0.9
			})
		).toBe(false);
		expect(
			isValidRequest({
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: 100,
				temperature: NaN,
				topP: 0.9
			})
		).toBe(false);
		expect(
			isValidRequest({
				type: 'generate',
				id: 1,
				messages: [],
				maxTokens: 100,
				temperature: 0,
				topP: 2
			})
		).toBe(false);
		expect(
			isValidRequest({
				type: 'generate',
				id: 1,
				messages: [{ role: 'user', content: 123 as unknown as string }],
				maxTokens: 100,
				temperature: 0,
				topP: 0.9
			})
		).toBe(false);
	});

	it('accepts valid generate and other types', () => {
		expect(isValidRequest({ type: 'load' })).toBe(true);
		expect(isValidRequest({ type: 'dispose' })).toBe(true);
		expect(isValidRequest({ type: 'cancel', id: 1 })).toBe(true);
		expect(
			isValidRequest({
				type: 'generate',
				id: 1,
				messages: [{ role: 'user', content: 'hi' }],
				maxTokens: 100,
				temperature: 0,
				topP: 0.9
			})
		).toBe(true);
	});
});
