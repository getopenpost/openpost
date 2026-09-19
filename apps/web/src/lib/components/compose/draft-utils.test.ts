import { describe, it, expect } from 'vitest';
import {
	encodeThreadDraft,
	decodeThreadDraft,
	getDraftPresentation,
	arraysEqual,
	makeVariantRecord,
	normalizeVariantRecord,
	variantPostEquals,
	variantRecordEquals,
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

describe('variant records', () => {
	const posts = [
		{ key: 'a', content: 'Hello', mediaIds: ['m1'] },
		{ key: 'b', content: 'World', mediaIds: [] }
	];

	it('arraysEqual compares string arrays by value', () => {
		expect(arraysEqual(['a'], ['a'])).toBe(true);
		expect(arraysEqual(['a'], ['b'])).toBe(false);
		expect(arraysEqual(['a'], ['a', 'b'])).toBe(false);
	});

	it('makeVariantRecord inherits every post', () => {
		expect(makeVariantRecord(posts)).toEqual({
			a: { content: 'Hello', mediaIds: ['m1'], contentInherited: true, mediaInherited: true },
			b: { content: 'World', mediaIds: [], contentInherited: true, mediaInherited: true }
		});
	});

	it('normalizeVariantRecord falls back to post content', () => {
		expect(
			normalizeVariantRecord(
				{ a: { content: 'Custom', mediaIds: [], contentInherited: false, mediaInherited: false } },
				posts
			)
		).toEqual({
			a: { content: 'Custom', mediaIds: [], contentInherited: false, mediaInherited: false },
			b: { content: 'World', mediaIds: [], contentInherited: false, mediaInherited: false }
		});
	});

	it('variantRecordEquals detects overrides', () => {
		const inherited = makeVariantRecord(posts);
		expect(variantRecordEquals(inherited, inherited, posts)).toBe(true);
		expect(variantRecordEquals(undefined, inherited, posts)).toBe(false);
		expect(
			variantRecordEquals(
				{ ...inherited, a: { ...inherited.a, content: 'Edited' } },
				inherited,
				posts
			)
		).toBe(false);
	});
});

describe('variantPostEquals', () => {
	const post = { key: 'a', content: 'Hello', mediaIds: ['m1'] };
	const variant = {
		content: 'Hello',
		mediaIds: ['m1'],
		contentInherited: true,
		mediaInherited: true
	};

	it('compares one post against its fallback', () => {
		expect(variantPostEquals(variant, variant, post)).toBe(true);
		// An absent entry carries no inherited flags, so it differs from an
		// explicit inherited record with the same content.
		expect(variantPostEquals(undefined, variant, post)).toBe(false);
		expect(variantPostEquals({ ...variant, content: 'Edited' }, variant, post)).toBe(false);
		expect(variantPostEquals({ ...variant, mediaIds: [] }, variant, post)).toBe(false);
	});
});
