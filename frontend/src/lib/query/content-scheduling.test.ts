import type { paths } from '@openpost/api-contract';
import createClient from 'openapi-fetch';
import { describe, expect, it, vi } from 'vitest';
import { createMediaQueryAPI } from './media';
import { createSchedulingQueryAPI } from './scheduling';

function transportWith(fetcher: typeof fetch) {
	return createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetcher });
}

describe('content and scheduling web query adapters', () => {
	it('paginates a scheduling range under one abort signal', async () => {
		const requests: Request[] = [];
		const fetcher = vi.fn(async (request: Request) => {
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

	it('normalizes media filters and preserves the request signal', async () => {
		let request: Request | undefined;
		const fetcher = vi.fn(async (nextRequest: Request) => {
			request = nextRequest;
			return new Response(JSON.stringify({ media: [], total: 0 }), {
				headers: { 'Content-Type': 'application/json' }
			});
		});
		const api = createMediaQueryAPI(transportWith(fetcher));
		const controller = new AbortController();

		await api.listMedia(
			'workspace-1',
			{
				lifecycle: 'library',
				filter: 'favorites',
				sort: 'newest',
				search: 'launch',
				type: 'image',
				source: '',
				assetKind: '',
				aspect: '',
				tagId: '',
				tagIds: ['tag-a', 'tag-b'],
				untagged: false,
				minWidth: 0,
				minHeight: 0,
				maxWidth: 0,
				maxHeight: 0,
				dateFrom: '',
				dateTo: '',
				limit: 40,
				offset: 0
			},
			controller.signal
		);

		expect(request).toBeDefined();
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
		expect(Object.fromEntries(new URL(request!.url).searchParams)).toMatchObject({
			workspace_id: 'workspace-1',
			filter: 'favorites',
			search: 'launch',
			tag_ids: 'tag-a,tag-b',
			limit: '40',
			offset: '0'
		});
	});

	it('normalizes raw media metadata and preserves the request signal', async () => {
		let request: Request | undefined;
		const rawFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			request = new Request(new URL(String(input), 'https://openpost.test'), init);
			return Response.json({
				media: [
					{
						id: 'media-1',
						mime_type: 'video/mp4',
						size: 512,
						processing_status: 'processing'
					},
					{ id: 42 }
				]
			});
		});
		const api = createMediaQueryAPI(transportWith(vi.fn()), rawFetch);
		const controller = new AbortController();

		await expect(
			api.getMediaMetadata('workspace-1', ['media-b', 'media-a'], controller.signal)
		).resolves.toEqual({
			media: [
				{
					id: 'media-1',
					mime_type: 'video/mp4',
					size: 512,
					processing_status: 'processing'
				}
			]
		});
		expect(request).toBeDefined();
		expect(Object.fromEntries(new URL(request!.url).searchParams)).toEqual({
			workspace_id: 'workspace-1',
			media_ids: 'media-b,media-a'
		});
		expect(request?.signal.aborted).toBe(false);
		controller.abort();
		expect(request?.signal.aborted).toBe(true);
	});
});
