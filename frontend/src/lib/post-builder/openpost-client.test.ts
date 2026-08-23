import { describe, expect, it, vi } from 'vitest';
import type { components } from '$lib/api/types';
import { createOpenPostBuilderClient } from './openpost-client';

function apiResult<TData>(data: TData, status = 200) {
	return { data, error: undefined, response: new Response(null, { status }) };
}

function apiClient(GET = vi.fn(), POST = vi.fn()) {
	// SAFETY: These test doubles cover the two generated client methods the adapter calls.
	return { GET, POST } as never;
}

function buildResponse(resultSources?: components['schemas']['ResolvedSource'][]) {
	const assets: Array<{ media_id: string; role: string; may_publish: boolean }> = [];
	const sources: Array<{ id: string; kind: string; label: string }> = [];
	const directionMedia: components['schemas']['MediaPlan'] = {
		treatment: 'none',
		brief: 'No media.',
		role: 'none'
	};
	const destinationMedia: components['schemas']['MediaPlan'] = {
		treatment: 'meme',
		brief: 'Use the diff screenshot.',
		role: 'attention'
	};
	const destinationClaims: Array<{
		text: string;
		status: string;
		source_refs: string[];
	}> = [];
	const response = {
		id: 'build-1',
		workspace_id: 'workspace-1',
		state: 'ready',
		phase: 'ready',
		revision: 4,
		assets,
		input: {
			sources,
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
				],
				media: directionMedia
			},
			destinations: [
				{
					account_id: 'account-1',
					platform: 'x',
					objective: 'shares',
					archetype: 'technical_opinion',
					output_profile: 'x.thread',
					preview: 'Deleting code was the feature.',
					warnings: [],
					claims: destinationClaims,
					media: destinationMedia
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
	if (!resultSources) return response;
	return { ...response, result: { ...response.result, sources: resultSources } };
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
						formatLabel: 'x.thread',
						objective: 'shares',
						archetype: 'technical_opinion',
						preview: 'Deleting code was the feature.'
					})
				],
				claims: [expect.objectContaining({ status: 'user_asserted' })],
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

	it('keeps the strictest duplicate claim status and maps source-aware media actions', async () => {
		const response = buildResponse([
			{ id: 'media:image-1', kind: 'image', label: 'safe-diff.png', publishable: true },
			{ id: 'media:video-1', kind: 'video', label: 'safe-demo.mp4', publishable: true }
		]);
		response.assets = [
			{ media_id: 'image-decoy', role: 'context', may_publish: true },
			{ media_id: 'image-1', role: 'evidence', may_publish: true },
			{ media_id: 'video-1', role: 'artifact', may_publish: true }
		];
		response.input.sources = [
			{ id: 'media:image-decoy', kind: 'image', label: 'decoy.png' },
			{ id: 'media:image-1', kind: 'image', label: 'diff.png' },
			{ id: 'media:video-1', kind: 'video', label: 'demo.mp4' }
		];
		response.result.direction.claims = [
			{ text: 'The product is faster', status: 'supported', source_refs: ['media:image-1'] }
		];
		response.result.direction.media = {
			treatment: 'annotate_source',
			brief: 'Circle the removed panel.',
			role: 'proof',
			source_ref: 'media:image-1'
		};
		response.result.destinations[0].claims = [
			{
				text: '  The product   is faster  ',
				status: 'needs_verification',
				source_refs: ['benchmark']
			}
		];
		response.result.destinations[0].media = {
			treatment: 'edit_existing_video',
			brief: 'Cut this to the feature reveal.',
			role: 'demo',
			source_ref: 'media:video-1'
		};
		const post = vi.fn().mockResolvedValue(apiResult(response));
		const api = createOpenPostBuilderClient({
			client: apiClient(vi.fn(), post),
			createIdempotencyKey: () => 'publication-builder:media'
		});

		const result = await api.create(buildInput());

		expect(result.result?.claims).toEqual([
			expect.objectContaining({
				status: 'needs_verification',
				sourceLabel: 'safe-diff.png, benchmark'
			})
		]);
		expect(result.result?.mediaPlan).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					treatment: 'annotate_source',
					action: undefined,
					sourceMediaId: 'image-1',
					sourceLabel: 'safe-diff.png'
				}),
				expect.objectContaining({
					action: 'video_editor',
					sourceMediaId: 'video-1',
					sourceLabel: 'safe-demo.mp4'
				})
			])
		);
	});

	it('shows the exact source for direct media use without inventing an editor action', async () => {
		const response = buildResponse();
		response.assets = [{ media_id: 'document-1', role: 'evidence', may_publish: true }];
		response.input.sources = [
			{ id: 'media:document-1', kind: 'document', label: 'release-notes.pdf' }
		];
		response.result.direction.media = {
			treatment: 'use_source',
			brief: 'Attach the release notes.',
			role: 'evidence',
			source_ref: 'media:document-1'
		};
		const post = vi.fn().mockResolvedValue(apiResult(response));
		const api = createOpenPostBuilderClient({
			client: apiClient(vi.fn(), post),
			createIdempotencyKey: () => 'publication-builder:direct-source'
		});

		const result = await api.create(buildInput());

		expect(result.result?.mediaPlan).toContainEqual(
			expect.objectContaining({
				treatment: 'use_source',
				sourceMediaId: 'document-1',
				sourceLabel: 'release-notes.pdf',
				action: undefined
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

	it('starts a new logical submission after the ready result is reset', async () => {
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
		api.resetSubmission('workspace-1');
		await api.create(buildInput());

		expect(post.mock.calls.map(([, options]) => options.params.header['Idempotency-Key'])).toEqual([
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
