import { describe, expect, it } from 'vitest';
import { firstComposerURL } from './composer-links';

describe('composer links', () => {
	it('derives the first URL from the post text without trailing sentence punctuation', () => {
		expect(
			firstComposerURL('Read https://openpost.social/docs, then tell me what you think.')
		).toBe('https://openpost.social/docs');
	});

	it('returns no synthetic link for plain text', () => {
		expect(firstComposerURL('A post without a URL')).toBe('');
	});
});
