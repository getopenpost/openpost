import { createPreviewModel } from '@openpost/social-preview';
import { expect, it } from 'vitest';
import {
	textCardIdentityForAccount,
	textCardRequest,
	textCardRequestKey,
	withTextCardDefaults,
	withTextCardImages
} from './text-cards';

it('joins a card and unique attachments in source order, retaining the first alt text', () => {
	const model = createPreviewModel({
		platform: 'instagram',
		identity: { displayName: 'Founder', handle: 'founder' },
		segments: [
			{
				id: 'a',
				text: 'First',
				media: [
					{
						id: 'photo',
						kind: 'image',
						src: '/first.jpg',
						alt: 'First description'
					}
				]
			},
			{
				id: 'b',
				text: 'Second',
				media: [
					{
						id: 'photo',
						kind: 'image',
						src: '/second.jpg',
						alt: 'Later description'
					},
					{ id: 'clip', kind: 'video', src: '/clip.mp4' }
				]
			}
		]
	});
	const request = textCardRequest('account', model, { text_card: 'always' }, 'instagram.carousel');
	expect(request).toMatchObject({
		text: 'First\n\nSecond',
		attachment_count: 2
	});
	const preview = withTextCardImages(model, [
		{ data_url: '/saved-card.jpg', width: 1080, height: 1350 }
	]);
	expect(preview.segments).toHaveLength(1);
	expect(preview.media.map((media) => media.src)).toEqual([
		'/saved-card.jpg',
		'/first.jpg',
		'/clip.mp4'
	]);
	expect(preview.media[1].alt).toBe('First description');
});

it('lets explicit text-card values win over catalogue defaults when merging', () => {
	const merged = withTextCardDefaults(
		{
			text_card: 'always',
			text_card_color: '#404040',
			text_card_rounded: undefined
		},
		{
			text_card: 'text_only',
			text_card_color: '#101010',
			text_card_rounded: false
		}
	);
	expect(merged).toMatchObject({
		text_card: 'always',
		text_card_color: '#404040',
		text_card_rounded: false
	});
});

it('derives the card identity from the same fields the server render receipt hashes', () => {
	expect(
		textCardIdentityForAccount({
			alias: 'Launch Buddy',
			account_username: 'founder',
			slug: 'founder',
			account_avatar_url: 'https://cdn.example/a.png'
		})
	).toEqual({
		name: 'Launch Buddy',
		handle: 'founder',
		avatar: 'https://cdn.example/a.png'
	});
	expect(textCardIdentityForAccount({ account_username: 'founder', slug: 'founder' }).name).toBe(
		'founder'
	);
	expect(textCardIdentityForAccount({ slug: 'founder' }).name).toBe('founder');
});

it('invalidates the preview key when account identity or the avatar changes', () => {
	const request = {
		social_account_id: 'account',
		text: 'A saved post',
		attachment_count: 0,
		settings: { text_card: 'text_only' }
	};
	const identity = {
		name: 'Founder',
		handle: 'founder',
		avatar: 'https://cdn.example/a.png'
	};
	expect(textCardRequestKey(request, identity)).toBe(textCardRequestKey(request, identity));
	expect(textCardRequestKey(request, identity)).not.toBe(
		textCardRequestKey(request, { ...identity, name: 'Renamed' })
	);
	expect(textCardRequestKey(request, identity)).not.toBe(
		textCardRequestKey(request, { ...identity, handle: 'someone-else' })
	);
	expect(textCardRequestKey(request, identity)).not.toBe(
		textCardRequestKey(request, {
			...identity,
			avatar: 'https://cdn.example/b.png'
		})
	);
});
