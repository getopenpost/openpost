import { describe, it, expect } from 'vitest';
import {
	encodeThreadDraft,
	decodeThreadDraft,
	getDraftPresentation,
	THREAD_DRAFT_PREFIX
} from './draft-utils';

describe('draft-utils', () => {
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
	});

	describe('decodeThreadDraft', () => {
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
	});
});
