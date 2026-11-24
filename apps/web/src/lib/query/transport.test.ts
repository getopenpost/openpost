import { OpenPostQueryError } from '@openpost/query-catalog';
import { describe, expect, it, vi } from 'vitest';
import { queryGET, queryPageResult } from './transport';
import { registerQueryAuthorizationBoundary } from './authorization-boundary';
import { afterEach } from 'vitest';

afterEach(() => {
	registerQueryAuthorizationBoundary(undefined);
});

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

	it('settles a query 401 against the identity captured before the request', async () => {
		const capturedIdentity = { userID: 'user-a', epoch: 4 };
		const settleUnauthorized = vi.fn();
		registerQueryAuthorizationBoundary({
			captureIdentity: () => capturedIdentity,
			settleUnauthorized
		});

		const request = queryGET({
			signal: new AbortController().signal,
			fallback: 'Unable to load security settings',
			request: async () => ({
				error: { detail: 'Session expired' },
				response: new Response(null, {
					status: 401,
					headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' }
				})
			})
		});

		await expect(request).rejects.toMatchObject({ status: 401 });
		expect(settleUnauthorized).toHaveBeenCalledWith(capturedIdentity);
	});

	it('does not settle a 401 that lacks the rejected-session challenge', async () => {
		const settleUnauthorized = vi.fn();
		registerQueryAuthorizationBoundary({
			captureIdentity: () => ({ userID: 'user-a', epoch: 4 }),
			settleUnauthorized
		});

		const request = queryGET({
			signal: new AbortController().signal,
			fallback: 'Unable to load security settings',
			request: async () => ({
				error: { detail: 'recent reauthentication is required' },
				response: new Response(null, { status: 401 })
			})
		});

		await expect(request).rejects.toMatchObject({ status: 401 });
		expect(settleUnauthorized).not.toHaveBeenCalled();
	});
});
