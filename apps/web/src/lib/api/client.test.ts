import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettlingApiClient } from './client';
import { registerQueryAuthorizationBoundary } from '$lib/query/authorization-boundary';

beforeEach(() => {
	// feedbackDiagnostics.recordResponse resolves request URLs against window.location.
	vi.stubGlobal('window', { location: { origin: 'https://openpost.test' } });
});

afterEach(() => {
	registerQueryAuthorizationBoundary(undefined);
	vi.unstubAllGlobals();
});

const sessionRejected = { 'WWW-Authenticate': 'Bearer error="invalid_token"' };

function mockserved(
	status: number,
	body: Record<string, string> = { detail: 'Session expired' },
	headers: Record<string, string> = {}
) {
	const fetchMock: typeof fetch = vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'Content-Type': 'application/json', ...headers }
			})
	);
	return fetchMock;
}

describe('api client authorization settlement', () => {
	it('settles a direct mutation 401 against the identity captured before the request', async () => {
		const beforeRequest = { userID: 'user-a', epoch: 4 };
		const captureIdentity = vi
			.fn()
			.mockReturnValueOnce(beforeRequest)
			.mockReturnValue({ userID: 'user-a', epoch: 5 });
		const settleUnauthorized = vi.fn();
		registerQueryAuthorizationBoundary({ captureIdentity, settleUnauthorized });

		const testClient = createSettlingApiClient(
			mockserved(401, { detail: 'invalid or expired token' }, sessionRejected)
		);
		const { response } = await testClient.POST('/prompts', {
			body: {
				category: 'launch',
				example: 'We shipped it.',
				text: 'Write a launch post.'
			}
		});

		expect(response.status).toBe(401);
		expect(captureIdentity).toHaveBeenCalled();
		expect(settleUnauthorized).toHaveBeenCalledTimes(1);
		expect(settleUnauthorized).toHaveBeenCalledWith(beforeRequest);
	});

	it('settles a direct read 401 against the identity captured before the request', async () => {
		const capturedIdentity = { userID: 'user-a', epoch: 4 };
		const settleUnauthorized = vi.fn();
		registerQueryAuthorizationBoundary({
			captureIdentity: () => capturedIdentity,
			settleUnauthorized
		});

		const testClient = createSettlingApiClient(
			mockserved(401, { detail: 'missing authorization header' }, sessionRejected)
		);
		const { response } = await testClient.GET('/prompts/categories', {});

		expect(response.status).toBe(401);
		expect(settleUnauthorized).toHaveBeenCalledWith(capturedIdentity);
	});

	it('leaves an action-level 401, such as recent reauthentication, with its caller', async () => {
		const settleUnauthorized = vi.fn();
		registerQueryAuthorizationBoundary({
			captureIdentity: () => ({ userID: 'user-a', epoch: 4 }),
			settleUnauthorized
		});

		const testClient = createSettlingApiClient(
			mockserved(401, { detail: 'recent reauthentication is required' })
		);
		const { error, response } = await testClient.DELETE('/workspaces/{id}', {
			params: { path: { id: 'workspace-1' } },
			body: { confirm_name: 'Workspace', current_password: 'wrong-password' }
		});

		expect(response.status).toBe(401);
		expect(error).toMatchObject({
			detail: 'recent reauthentication is required'
		});
		expect(settleUnauthorized).not.toHaveBeenCalled();
	});
});
