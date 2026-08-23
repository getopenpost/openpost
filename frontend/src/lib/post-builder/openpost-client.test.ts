import { describe, expect, it, vi } from 'vitest';
import { createOpenPostBuilderClient } from './openpost-client';

function apiResult<TData>(data: TData, status = 200) {
	return { data, error: undefined, response: new Response(null, { status }) };
}

function apiClient(GET = vi.fn(), POST = vi.fn()) {
	// SAFETY: These test doubles cover the two generated client methods the adapter calls.
	return { GET, POST } as never;
}

function buildResponse() {
	return {
		id: 'build-1',
		workspace_id: 'workspace-1',
		state: 'ready',
		phase: 'ready',
		revision: 4,
		input: {
			destinations: [
				{
					account_id: 'account-1',
					platform: 'x',
					label: '@rodrigo',
					voice: { name: 'Rodrigo' }
				}
			]
		},
		result: {
			canonical_text: 'The product got smaller and better.',
			direction: {
				thesis: 'Deleting code improved the product.',
				outcome: 'Start discussion',
				audience: 'Product engineers',
				angle: 'Less code as product progress',
				claims: [
					{
						text: '15,000 lines were removed',
						status: 'user_asserted',
						source_refs: ['idea']
					}
				]
			},
			destinations: [
				{
					account_id: 'account-1',
					platform: 'x',
					output_profile: 'x.thread',
					warnings: [],
					media: { treatment: 'meme', brief: 'Use the diff screenshot.' }
				}
			],
			review_flags: [
				{
					account_id: 'account-1',
					field: 'claim',
					severity: 'warning',
					message: 'Confirm the line count.'
				}
			]
		}
	};
}

function buildInput(sourceText = 'I removed a large feature.') {
	return {
		workspaceId: 'workspace-1',
		mode: 'source' as const,
		sourceText,
		contextUrls: ['https://example.com/release'],
		assets: [{ mediaId: 'media-1', role: 'evidence' as const, mayPublish: false }],
		accountIds: ['account-1'],
		direction: {
			goal: 'Start discussion',
			destinationStrategy: 'recommend' as const
		}
	};
}

describe('OpenPost publication builder API client', () => {
	it('sends the typed builder contract and maps reviewable results', async () => {
		const post = vi.fn().mockResolvedValue(apiResult(buildResponse()));
		const api = createOpenPostBuilderClient({
			client: apiClient(vi.fn(), post),
			createIdempotencyKey: () => 'publication-builder:test-1'
		});

		const result = await api.create(buildInput());

		expect(result).toMatchObject({
			id: 'build-1',
			phase: 'ready',
			result: {
				thesis: 'Deleting code improved the product.',
				voiceLabel: 'Rodrigo',
				destinationDecisions: [
					expect.objectContaining({
						accountLabel: '@rodrigo',
						status: 'needs_review',
						formatLabel: 'x.thread'
					})
				],
				claims: [expect.objectContaining({ status: 'needs_review' })],
				mediaPlan: [
					expect.objectContaining({
						action: 'meme',
						brief: 'Use the diff screenshot.'
					})
				]
			}
		});
		expect(post).toHaveBeenCalledWith(
			'/publication-builds',
			expect.objectContaining({
				params: { header: { 'Idempotency-Key': 'publication-builder:test-1' } },
				body: expect.objectContaining({
					workspace_id: 'workspace-1',
					context_urls: ['https://example.com/release'],
					assets: [{ media_id: 'media-1', role: 'evidence', may_publish: false }],
					direction: expect.objectContaining({ outcome: 'Start discussion' }),
					destination_policy: 'recommend'
				})
			})
		);
	});

	it('reuses one idempotency key until the form changes', async () => {
		const post = vi.fn().mockResolvedValue(apiResult(buildResponse()));
		const createKey = vi
			.fn()
			.mockReturnValueOnce('publication-builder:first')
			.mockReturnValueOnce('publication-builder:second');
		const api = createOpenPostBuilderClient({
			client: apiClient(vi.fn(), post),
			createIdempotencyKey: createKey
		});

		await api.create(buildInput());
		await api.create(buildInput());
		await api.create(buildInput('A materially different source.'));

		expect(post.mock.calls.map(([, options]) => options.params.header['Idempotency-Key'])).toEqual([
			'publication-builder:first',
			'publication-builder:first',
			'publication-builder:second'
		]);
	});

	it('loads feature availability and keeps an unconfigured builder off', async () => {
		const get = vi
			.fn()
			.mockResolvedValue(
				apiResult({ content_builder_enabled: false, content_discovery_enabled: false })
			);
		const api = createOpenPostBuilderClient({
			client: apiClient(get)
		});

		await expect(api.availability()).resolves.toEqual({
			builderEnabled: false,
			discoveryEnabled: false
		});
	});

	it('sends only the selected Voice Profile ID and maps cited opportunities', async () => {
		const post = vi.fn().mockResolvedValue(
			apiResult({
				generated_at: '2026-08-23T10:00:00Z',
				model: 'model-1',
				opportunities: [
					{
						id: 'opportunity-1',
						title: 'A provider changed its API',
						why_it_fits: 'You write about provider limits.',
						why_now: 'The change shipped today.',
						signal_date: '2026-08-23',
						hook: 'The API got simpler.',
						angles: [
							{
								id: 'angle-1',
								label: 'Practical founder take',
								thesis: 'The smaller API cuts integration work.',
								approach: 'Compare the old and new setup.'
							}
						],
						sources: [
							{
								title: 'Release notes',
								url: 'https://example.com/release',
								publisher: 'Example'
							}
						],
						platform_treatments: [
							{
								platform: 'linkedin',
								format: 'Evidence-led opinion',
								rationale: 'The source has a clear before and after.'
							}
						]
					}
				]
			})
		);
		const api = createOpenPostBuilderClient({
			client: apiClient(vi.fn(), post)
		});

		const opportunities = await api.discover({
			workspaceId: 'workspace-1',
			voiceProfileId: 'voice-1',
			platforms: ['linkedin']
		});

		expect(opportunities).toEqual([
			expect.objectContaining({
				id: 'opportunity-1',
				summary: 'The change shipped today.',
				sourceURLs: ['https://example.com/release'],
				angles: [
					expect.objectContaining({
						label: 'Practical founder take',
						description: 'The smaller API cuts integration work. Compare the old and new setup.'
					})
				]
			})
		]);
		const body = post.mock.calls[0][1].body;
		expect(body).toMatchObject({ voice_profile_id: 'voice-1' });
		expect(body).not.toHaveProperty('voice');
		expect(body).not.toHaveProperty('recent_publications');
	});
});
