import { describe, expect, it } from 'vitest';
import { safeSameOriginRedirect } from './redirects';

describe('safeSameOriginRedirect', () => {
	it('preserves a same-origin path, query, and hash', () => {
		const url = new URL(
			`https://app.openpost.social/login?redirect=${encodeURIComponent('/calendar?view=week#scheduled')}`
		);

		expect(safeSameOriginRedirect(url)).toBe('/calendar?view=week#scheduled');
	});

	it.each([
		'https://example.com/steal',
		'//example.com/steal',
		'\\example.com\\steal',
		'javascript:alert(1)'
	])('rejects an unsafe redirect target: %s', (redirect) => {
		const url = new URL(
			`https://app.openpost.social/login?redirect=${encodeURIComponent(redirect)}`
		);

		expect(safeSameOriginRedirect(url)).toBe('/');
	});
});
