import { describe, expect, it } from 'vitest';
import { firstComposerURL } from './composer-links';

describe('composer links', () => {
	it('derives the first URL from the post text without trailing sentence punctuation', () => {
		expect(firstComposerURL('Read https://example.com/docs, then tell me what you think.')).toBe(
			'https://example.com/docs'
		);
	});

	it('keeps balanced URL parentheses but drops enclosing punctuation', () => {
		expect(firstComposerURL('(see https://en.wikipedia.org/wiki/Go_(programming_language)).')).toBe(
			'https://en.wikipedia.org/wiki/Go_(programming_language)'
		);
		expect(firstComposerURL('(see https://example.com/x)')).toBe('https://example.com/x');
	});

	it('returns no synthetic link for plain text', () => {
		expect(firstComposerURL('A post without a URL')).toBe('');
	});
});
