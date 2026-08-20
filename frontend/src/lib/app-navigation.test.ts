import { describe, expect, it } from 'vitest';
import {
	isNavigationItemActive,
	isOrganizationOwnershipSettingsRoute,
	mobileNavigation,
	primaryNavigation
} from './app-navigation';

describe('primary application navigation', () => {
	it('keeps every core destination visible instead of hiding it in account menus', () => {
		expect(primaryNavigation.map((item) => item.label)).toEqual([
			'New post',
			'Calendar',
			'Posts',
			'Inbox',
			'Grow',
			'Analytics',
			'Media',
			'Editors',
			'Settings'
		]);
	});

	it('places Grow between Inbox and Analytics and away from the mobile bar', () => {
		const ids = primaryNavigation.map((item) => item.id);
		expect(ids.indexOf('growth')).toBeGreaterThan(ids.indexOf('communications'));
		expect(ids.indexOf('growth')).toBeLessThan(ids.indexOf('analytics'));
		expect(primaryNavigation.find((item) => item.id === 'growth')).toMatchObject({
			href: '/grow',
			match: ['/grow'],
			mobile: false
		});
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

	it('recognizes both supported ownership Settings URLs without a Workspace', () => {
		expect(
			isOrganizationOwnershipSettingsRoute(new URL('https://openpost.test/settings?tab=ownership'))
		).toBe(true);
		expect(
			isOrganizationOwnershipSettingsRoute(new URL('https://openpost.test/settings#ownership'))
		).toBe(true);
		expect(
			isOrganizationOwnershipSettingsRoute(new URL('https://openpost.test/settings#plan'))
		).toBe(false);
	});
});
