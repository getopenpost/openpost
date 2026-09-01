import { OpenPostQueryError } from '@openpost/query-catalog';
import { describe, expect, it, vi } from 'vitest';
import { queryGET, queryPageResult } from './transport';

describe('web query transport', () => {
	it('passes the request signal through and returns typed data with response metadata', async () => {
		const controller = new AbortController();
		const response = new Response(null, {
			headers: { 'X-Next-Cursor': 'next-2', 'X-Total-Count': '17' }
		});
		const request = vi.fn(async (signal: AbortSignal) => ({
			data: [{ id: 'publication-1' }],
			response,
			signal
		}));

		const result = await queryGET({
			signal: controller.signal,
			fallback: 'Unable to load publications',
			request
		});

		expect(request).toHaveBeenCalledWith(controller.signal);
		expect(result.data).toEqual([{ id: 'publication-1' }]);
		expect(queryPageResult(result.data, result.response)).toEqual({
			items: [{ id: 'publication-1' }],
			total: 17,
			nextCursor: 'next-2'
		});
	});

	it('classifies typed HTTP problems for the shared retry policy', async () => {
		const request = queryGET({
			signal: new AbortController().signal,
			fallback: 'Unable to load publications',
			request: async () => ({
				error: { detail: '  Workspace is unavailable  ' },
				response: new Response(null, { status: 503 })
			})
		});

		await expect(request).rejects.toEqual(
			expect.objectContaining<Partial<OpenPostQueryError>>({
				name: 'OpenPostQueryError',
				message: 'Workspace is unavailable',
				detail: 'Workspace is unavailable',
				status: 503
			})
		);
	});

	it('uses the caller fallback when a successful response has no data', async () => {
		const request = queryGET({
			signal: new AbortController().signal,
			fallback: 'Publication response was empty',
			request: async () => ({ data: undefined, response: new Response(null) })
		});

		await expect(request).rejects.toEqual(
			expect.objectContaining<Partial<OpenPostQueryError>>({
				message: 'Publication response was empty',
				status: 200
			})
		);
	});

	it('does not replace network or cancellation errors raised before a response', async () => {
		const abortError = new DOMException('cancelled', 'AbortError');
		const request = queryGET({
			signal: new AbortController().signal,
			fallback: 'Unable to load publications',
			request: async () => {
				throw abortError;
			}
		});

		await expect(request).rejects.toBe(abortError);
	});
});
