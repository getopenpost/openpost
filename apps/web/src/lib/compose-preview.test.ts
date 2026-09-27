import {
	createPreviewModel,
	normalizePreviewPlatform,
	previewCapabilities,
	previewPlatforms,
	supportsPreviewFormat
} from '@openpost/social-preview';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SocialAccount } from '$lib/api/client';
import { buildComposerPreview, previewFormat } from './compose-preview';

const account = {
	id: 'account-1',
	platform: 'mastodon:https://social.example',
	account_username: '@openpost',
	account_avatar_url: 'https://example.com/avatar.png',
	account_id: 'provider-account-1',
	grant_destination_count: 1,
	instance_url: 'https://social.example',
	is_active: true,
	messages_enabled: false,
	messaging_supported: false,
	shared_grant: false,
	slug: 'openpost',
	thread_replies_supported: true
} satisfies SocialAccount;

describe('social preview model', () => {
	it('defines a preview capability for every supported destination', () => {
		expect(Object.keys(previewCapabilities).sort()).toEqual([...previewPlatforms].sort());
		expect(
			previewPlatforms.every((platform) => previewCapabilities[platform].formats.length > 0)
		).toBe(true);
	});

	it('can preview every built-in backend provider, including gated providers', () => {
		const backendCatalog = readFileSync(
			new URL('../../../server/internal/capabilities/capabilities.go', import.meta.url),
			'utf8'
		);
		const providerValues = new Map(
			[...backendCatalog.matchAll(/(Provider[A-Za-z]+)\s+=\s+"([^"]+)"/gu)].map((match) => [
				match[1],
				match[2]
			])
		);
		const backendProviders = [
			...backendCatalog.matchAll(/Capability\{Provider:\s+(Provider[A-Za-z]+)[^\n]*\}/gu)
		]
			.map((match) => providerValues.get(match[1]))
			.filter((provider): provider is string => Boolean(provider));

		expect(previewPlatforms).toEqual(expect.arrayContaining([...new Set(backendProviders)]));
	});

	it('normalizes instance-qualified platforms and safe defaults', () => {
		expect(normalizePreviewPlatform('mastodon:https://social.example')).toBe('mastodon');
		expect(normalizePreviewPlatform('INSTAGRAM')).toBe('instagram');
		expect(normalizePreviewPlatform('unknown-provider')).toBe('unsupported');
	});

	it('normalizes identity and defaults without changing supported content', () => {
		const model = createPreviewModel({
			platform: 'x',
			identity: { displayName: '', handle: '@creator' },
			segments: [{ id: 'one', text: 'A destination-aware post.' }]
		});

		expect(model.identity).toMatchObject({ displayName: 'Your name', handle: 'creator' });
		expect(model.segments[0]?.text).toBe('A destination-aware post.');
		expect(supportsPreviewFormat('x', 'thread')).toBe(true);
		expect(supportsPreviewFormat('instagram', 'thread')).toBe(false);
	});
});

describe('composer preview mapping', () => {
	it('keeps an explicit feed format when the post contains video', () => {
		const model = buildComposerPreview({
			account: { ...account, platform: 'facebook' },
			mode: 'post',
			outputProfile: 'facebook.post',
			segments: [{ id: 'one', text: 'Feed video', media: [{ id: 'clip', mimeType: 'video/mp4' }] }]
		});
		expect(model.format).toBe('post');
	});

	it('preserves a cleared first-segment attachment override', () => {
		const model = buildComposerPreview({
			account,
			mode: 'post',
			segments: [{ id: 'one', text: 'Text only', media: [] }],
			media: [{ id: 'shared-image', mimeType: 'image/jpeg' }]
		});
		expect(model.media).toEqual([]);
	});

	it('joins destination segments when the publishing contract joins them', () => {
		const model = buildComposerPreview({
			account: { ...account, platform: 'linkedin' },
			mode: 'thread',
			outputProfile: 'linkedin.post',
			segmentStrategy: 'join',
			segments: [
				{ id: 'one', text: 'First paragraph' },
				{ id: 'two', text: 'Second paragraph' }
			]
		});
		expect(model.segments.map((segment) => segment.text)).toEqual([
			'First paragraph\n\nSecond paragraph'
		]);
	});

	it('maps Pin and business post settings to visible content', () => {
		const pin = buildComposerPreview({
			account: { ...account, platform: 'pinterest' },
			mode: 'post',
			segments: [{ id: 'one', text: 'Description' }],
			destinationSettings: {
				pin_title: 'Launch board',
				destination_link: 'https://example.com/launch'
			}
		});
		expect(pin).toMatchObject({
			platform: 'pinterest',
			title: 'Launch board',
			card: { domain: 'example.com' }
		});
		const business = buildComposerPreview({
			account: { ...account, platform: 'googlebusiness' },
			mode: 'post',
			segments: [{ id: 'one', text: 'Join us' }],
			destinationSettings: {
				topic_type: 'event',
				event_title: 'Open studio',
				event_start_date: '2026-10-03',
				event_end_date: '2026-10-04',
				call_to_action: 'book',
				action_url: 'https://example.com/book'
			}
		});
		expect(business).toMatchObject({
			platform: 'googlebusiness',
			title: 'Open studio',
			business: {
				topic: 'event',
				startDate: '2026-10-03',
				endDate: '2026-10-04',
				action: 'book',
				actionUrl: 'https://example.com/book'
			}
		});
	});

	it('maps resolved destination profiles to native-looking preview formats', () => {
		expect(previewFormat('x', 'thread', [], 'x.thread')).toBe('thread');
		expect(previewFormat('instagram', 'post', [], 'instagram.reel')).toBe('reel');
		expect(previewFormat('facebook', 'post', [], 'facebook.story')).toBe('story');
		expect(previewFormat('youtube', 'post', [], 'youtube.short')).toBe('short');
		expect(previewFormat('youtube', 'post', [], 'youtube.video')).toBe('video');
		expect(previewFormat('tiktok', 'post', [], 'tiktok.video')).toBe('video');
		expect(previewFormat('peertube', 'post', [], '')).toBe('video');
		expect(previewFormat('peertube', 'post', [], 'peertube.video')).toBe('video');
		expect(previewFormat('pixelfed', 'post', [], '')).toBe('post');
		expect(previewFormat('lemmy', 'post', [], '')).toBe('post');
		expect(previewFormat('piefed', 'post', [], '')).toBe('post');
		expect(previewFormat('tiktok', 'post', [], 'tiktok.photo')).toBe('photo');
		expect(
			previewFormat(
				'linkedin',
				'post',
				[{ id: 'document', kind: 'document', src: '/media/document' }],
				'linkedin.document'
			)
		).toBe('document');
		expect(
			previewFormat('tiktok', 'post', [{ id: 'photo', kind: 'image', src: '/media/photo' }])
		).toBe('photo');
	});

	it('preserves commas in poll answers on each thread segment', () => {
		const model = buildComposerPreview({
			account,
			mode: 'thread',
			segments: [
				{ id: 'one', text: 'First', settings: { poll_options: 'Yes, sometimes\nNever' } },
				{ id: 'two', text: 'Second', settings: { poll_options: 'Red, green\nBlue' } }
			]
		});
		expect(model.segments?.[0].poll?.options).toEqual(['Yes, sometimes', 'Never']);
		expect(model.segments?.[1].poll?.options).toEqual(['Red, green', 'Blue']);
	});

	it('maps destination settings without exposing them in the preview URL', () => {
		const model = buildComposerPreview({
			account,
			mode: 'post',
			segments: [{ id: 'primary', text: 'What should we publish next?' }],
			destinationSettings: {
				spoiler_text: 'Product research',
				visibility: 'unlisted',
				poll_options: ['Previews', 'Analytics'],
				poll_duration_minutes: 30,
				link_url: 'https://example.com/tools',
				link_title: 'Free social tools',
				link_image_url: 'https://example.com/social-card.png',
				location_name: 'Lisbon'
			}
		});

		expect(model).toMatchObject({
			platform: 'mastodon',
			format: 'post',
			contentWarning: 'Product research',
			visibility: 'unlisted',
			poll: {
				options: ['Previews', 'Analytics'],
				durationLabel: '30 minutes'
			},
			card: {
				kind: 'link',
				title: 'Free social tools',
				domain: 'example.com',
				imageUrl: 'https://example.com/social-card.png'
			},
			location: 'Lisbon'
		});
	});

	it('uses the actual destination format for documents and photo posts', () => {
		const linkedInModel = buildComposerPreview({
			account: { ...account, platform: 'linkedin' },
			mode: 'post',
			segments: [
				{
					id: 'primary',
					text: 'Read the report',
					media: [{ id: 'report', mimeType: 'application/pdf' }]
				}
			],
			destinationSettings: { document_title: 'The 2026 report' }
		});
		const tiktokModel = buildComposerPreview({
			account: { ...account, platform: 'tiktok' },
			mode: 'post',
			segments: [
				{
					id: 'primary',
					text: 'A photo post',
					media: [{ id: 'photo', mimeType: 'image/jpeg' }]
				}
			]
		});

		expect(linkedInModel).toMatchObject({
			platform: 'linkedin',
			format: 'document',
			title: 'The 2026 report'
		});
		expect(tiktokModel).toMatchObject({ platform: 'tiktok', format: 'photo' });
	});
});
