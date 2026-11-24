import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createSchedulingQueryAPI } from './scheduling';

function transportWith(fetcher: typeof fetch) {
	return createClient<paths>({
		baseUrl: 'https://openpost.test/api/v1',
		fetch: fetcher
	});
}

describe('content and scheduling web query adapters', () => {
	it('paginates a scheduling range under one abort signal', async () => {
		const requests: Request[] = [];
		const fetcher = vi.fn<typeof fetch>(async (input, init) => {
			const request = input instanceof Request ? input : new Request(input, init);
			requests.push(request);
			const offset = new URL(request.url).searchParams.get('offset');
			return new Response(JSON.stringify([{ id: `publication-${offset}` }]), {
				headers: {
					'Content-Type': 'application/json',
					'X-Has-More': offset === '0' ? 'true' : 'false',
					'X-Next-Offset': '200'
				}
			});
		});
		const api = createSchedulingQueryAPI(transportWith(fetcher));
		const controller = new AbortController();

		const result = await api.listPublications(
			'workspace-1',
			{
				status: '',
				contentProfile: '',
				platform: '',
				search: '',
				createdFrom: '',
				createdBefore: '',
				calendarFrom: '2026-09-01T00:00:00Z',
				calendarBefore: '2026-10-01T00:00:00Z',
				limit: 200,
				allPages: true
			},
			controller.signal
		);

		expect(result.map((publication) => publication.id)).toEqual([
			'publication-0',
			'publication-200'
		]);
		expect(requests).toHaveLength(2);
		expect(requests.every((request) => !request.signal.aborted)).toBe(true);
		controller.abort();
		expect(requests.every((request) => request.signal.aborted)).toBe(true);
		expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toMatchObject({
			workspace_id: 'workspace-1',
			calendar_from: '2026-09-01T00:00:00Z',
			calendar_before: '2026-10-01T00:00:00Z',
			limit: '200',
			offset: '0'
		});
	});

	it('keeps bounded publication lists to one request even when another page exists', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response(JSON.stringify([{ id: 'publication-1' }]), {
					headers: {
						'Content-Type': 'application/json',
						'X-Has-More': 'true',
						'X-Next-Offset': '50'
					}
				})
		);
		const api = createSchedulingQueryAPI(transportWith(fetcher));

		const result = await api.listPublications(
			'workspace-1',
			{
				status: 'draft',
				contentProfile: '',
				platform: '',
				search: '',
				createdFrom: '',
				createdBefore: '',
				calendarFrom: '',
				calendarBefore: '',
				limit: 50,
				allPages: false
			},
			new AbortController().signal
		);

		expect(result.map((publication) => publication.id)).toEqual(['publication-1']);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
