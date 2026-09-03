import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createVoiceProfileQueryAPI } from './voice-profiles';

describe('Voice Profile web query adapter', () => {
	it('normalizes nullable lists and forwards the Query signal', async () => {
		let request: Request | undefined;
		const fetcher = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return Response.json(null);
		});
		const api = createVoiceProfileQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetcher })
		);
		const controller = new AbortController();

		await expect(api.listVoiceProfiles('workspace-1', controller.signal)).resolves.toEqual([]);
		expect(request).toBeDefined();
		expect(new URL(request!.url).pathname).toBe('/api/v1/voice-profiles');
		expect(new URL(request!.url).searchParams.get('workspace_id')).toBe('workspace-1');
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
	});
});
