import { describe, it, expect } from 'vitest';
import {
	makeEmptyPost,
	encodeThreadDraft,
	decodeThreadDraft,
	isThreadDraft,
	hasAnyContent,
	getDraftSnapshot,
	getDraftPresentation,
	THREAD_DRAFT_PREFIX
} from './draft-utils';

describe('draft-utils', () => {
	describe('makeEmptyPost', () => {
		it('creates a post with empty content and no media', () => {
			const post = makeEmptyPost();
			expect(post.content).toBe('');
			expect(post.mediaIds).toEqual([]);
			expect(post.key).toBeTruthy();
		});
	});

	describe('encodeThreadDraft', () => {
		it('encodes posts to thread draft format', () => {
			const posts = [
				{ key: 'a', content: 'Hello', mediaIds: ['m1'] },
				{ key: 'b', content: 'World', mediaIds: [] }
			];
			const encoded = encodeThreadDraft(posts);
			expect(encoded.startsWith(THREAD_DRAFT_PREFIX)).toBe(true);
			const decoded = decodeThreadDraft(encoded);
			expect(decoded).toEqual({
				posts: [
					{ key: 'a', content: 'Hello', mediaIds: ['m1'] },
					{ key: 'b', content: 'World', mediaIds: [] }
				],
				variants: {}
			});
		});

		it('preserves per-account thread variants', () => {
			const posts = [
				{ key: 'a', content: 'Hello', mediaIds: ['m1'] },
				{ key: 'b', content: 'World', mediaIds: [] }
			];
			const encoded = encodeThreadDraft(posts, {
				acc1: {
					a: { content: 'Olá', mediaIds: [] },
					b: { content: 'Mundo', mediaIds: [] }
				}
			});
			expect(decodeThreadDraft(encoded)).toEqual({
				posts: [
					{ key: 'a', content: 'Hello', mediaIds: ['m1'] },
					{ key: 'b', content: 'World', mediaIds: [] }
				],
				variants: {
					acc1: {
						a: { content: 'Olá', mediaIds: [] },
						b: { content: 'Mundo', mediaIds: [] }
					}
				}
			});
		});

		it('preserves per-account thread media variants', () => {
			const posts = [
				{ key: 'a', content: 'Hello', mediaIds: ['m1'] },
				{ key: 'b', content: 'World', mediaIds: [] }
			];
			const encoded = encodeThreadDraft(posts, {
				acc1: {
					a: { content: 'Olá', mediaIds: [] },
					b: { content: 'Mundo', mediaIds: ['m2'] }
				}
			});
			expect(decodeThreadDraft(encoded)?.variants.acc1.b).toEqual({
				content: 'Mundo',
				mediaIds: ['m2']
			});
		});
	});

	describe('isThreadDraft', () => {
		it('returns true for thread draft content', () => {
			expect(isThreadDraft(THREAD_DRAFT_PREFIX + '[]')).toBe(true);
		});
		it('returns false for regular content', () => {
			expect(isThreadDraft('Hello world')).toBe(false);
		});
	});

	describe('decodeThreadDraft', () => {
		it('returns null for invalid content', () => {
			expect(decodeThreadDraft('not a thread')).toBeNull();
		});
		it('returns null for invalid JSON', () => {
			expect(decodeThreadDraft(THREAD_DRAFT_PREFIX + 'invalid')).toBeNull();
		});

		it('supports legacy array-based variant drafts', () => {
			const decoded = decodeThreadDraft(
				THREAD_DRAFT_PREFIX +
					JSON.stringify({
						p: [
							{ c: 'Hello', m: [] },
							{ c: 'World', m: [] }
						],
						v: {
							acc1: ['Olá', 'Mundo']
						}
					})
			);
			expect(decoded).toEqual({
				posts: [
					{ key: expect.any(String), content: 'Hello', mediaIds: [] },
					{ key: expect.any(String), content: 'World', mediaIds: [] }
				],
				variants: {
					acc1: {
						'0': { content: 'Olá', mediaIds: [] },
						'1': { content: 'Mundo', mediaIds: [] }
					}
				}
			});
		});
	});

	describe('hasAnyContent', () => {
		it('returns true if any post has text', () => {
			expect(hasAnyContent([{ key: 'a', content: 'Hi', mediaIds: [] }])).toBe(true);
		});
		it('returns true if any post has media', () => {
			expect(hasAnyContent([{ key: 'a', content: '', mediaIds: ['m1'] }])).toBe(true);
		});
		it('returns false for empty posts', () => {
			expect(hasAnyContent([{ key: 'a', content: '', mediaIds: [] }])).toBe(false);
		});
	});

	describe('getDraftSnapshot', () => {
		it('returns consistent snapshot for same posts', () => {
			const posts = [{ key: 'a', content: 'Hello', mediaIds: ['m1'] }];
			expect(getDraftSnapshot(posts)).toBe(getDraftSnapshot(posts));
		});
	});

	describe('getDraftPresentation', () => {
		it('uses the dedicated thread draft for its title, count, and media state', () => {
			const threadDraft = encodeThreadDraft([
				{ key: 'a', content: 'Launch notes', mediaIds: [] },
				{ key: 'b', content: 'The follow-up', mediaIds: ['media-1'] }
			]);

			expect(
				getDraftPresentation({
					content: 'Launch notes',
					thread_draft: threadDraft,
					media_ids: []
				})
			).toEqual({
				title: 'Launch notes',
				postCount: 2,
				isThread: true,
				hasMedia: true
			});
		});

		it('falls back to a useful title for an empty regular draft', () => {
			expect(getDraftPresentation({ content: '', media_ids: [] })).toEqual({
				title: 'Untitled post',
				postCount: 1,
				isThread: false,
				hasMedia: false
			});
		});
	});
});
