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
	account_avatar_url: 'https://example.com/avatar.png'
} as SocialAccount;

describe('social preview model', () => {
	it('defines a preview capability for every supported destination', () => {
		expect(Object.keys(previewCapabilities).sort()).toEqual([...previewPlatforms].sort());
		expect(
			previewPlatforms.every((platform) => previewCapabilities[platform].formats.length > 0)
		).toBe(true);
	});

	it('stays in sync with the backend provider registry', () => {
		const backendCatalog = readFileSync(
			new URL('../../../backend/internal/capabilities/capabilities.go', import.meta.url),
			'utf8'
		);
		const backendProviders = [
			...backendCatalog.matchAll(/Provider[A-Za-z]+\s+=\s+"([^"]+)"/gu)
		].map((match) => match[1]);

		expect([...new Set(backendProviders)].sort()).toEqual([...previewPlatforms].sort());
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
	it('maps resolved destination profiles to native-looking preview formats', () => {
		expect(previewFormat('x', 'thread', [], 'x.thread')).toBe('thread');
		expect(previewFormat('instagram', 'post', [], 'instagram.reel')).toBe('reel');
		expect(previewFormat('facebook', 'post', [], 'facebook.story')).toBe('story');
		expect(previewFormat('youtube', 'post', [], 'youtube.short')).toBe('short');
		expect(previewFormat('youtube', 'post', [], 'youtube.video')).toBe('video');
		expect(previewFormat('tiktok', 'post', [], 'tiktok.video')).toBe('video');
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
				link_url: 'https://openpost.social/tools',
				link_title: 'Free social tools',
				link_image_url: 'https://openpost.social/social-card.png',
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
				domain: 'openpost.social',
				imageUrl: 'https://openpost.social/social-card.png'
			},
			location: 'Lisbon'
		});
	});

	it('uses the actual destination format for documents and photo posts', () => {
		const linkedInModel = buildComposerPreview({
			account: { ...account, platform: 'linkedin' } as SocialAccount,
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
			account: { ...account, platform: 'tiktok' } as SocialAccount,
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
