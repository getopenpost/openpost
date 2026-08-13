import { describe, expect, it } from 'vitest';
import { isNavigationItemActive, mobileNavigation, primaryNavigation } from './app-navigation';

describe('primary application navigation', () => {
	it('keeps every core destination visible instead of hiding it in account menus', () => {
		expect(primaryNavigation.map((item) => item.label)).toEqual([
			'New post',
			'Calendar',
			'Posts',
			'Inbox',
			'Analytics',
			'Media',
			'Editors',
			'Settings'
		]);
	});

	it('treats post details as part of Posts without claiming the composer root', () => {
		const posts = primaryNavigation.find((item) => item.id === 'posts');
		const composer = primaryNavigation.find((item) => item.id === 'new');

		expect(posts && isNavigationItemActive(posts, '/posts/post-123')).toBe(true);
		expect(composer && isNavigationItemActive(composer, '/posts/post-123')).toBe(false);
		expect(composer && isNavigationItemActive(composer, '/')).toBe(true);
	});

	it('keeps four content destinations in the mobile bar before the More menu', () => {
		expect(mobileNavigation.map((item) => item.id)).toEqual(['calendar', 'posts', 'new', 'media']);
	});
});
