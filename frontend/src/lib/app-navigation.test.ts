import { describe, expect, it } from 'vitest';
import {
	isNavigationItemActive,
	isOrganizationOwnershipSettingsRoute,
	primaryNavigation
} from './app-navigation';

describe('primary application navigation', () => {
	it('treats publication details as part of Publications without claiming the composer root', () => {
		const publications = primaryNavigation.find((item) => item.id === 'publications');
		const composer = primaryNavigation.find((item) => item.id === 'new');

		expect(publications && isNavigationItemActive(publications, '/publications/pub-123')).toBe(
			true
		);
		expect(composer && isNavigationItemActive(composer, '/publications/pub-123')).toBe(false);
		expect(composer && isNavigationItemActive(composer, '/')).toBe(true);
	});

	it('shares the communications route family across every Inbox destination', () => {
		const inbox = primaryNavigation.find((item) => item.id === 'communications');

		expect(inbox && isNavigationItemActive(inbox, '/inbox/engagement')).toBe(true);
		expect(inbox && isNavigationItemActive(inbox, '/inbox/messages')).toBe(true);
		expect(inbox && isNavigationItemActive(inbox, '/inbox/notifications')).toBe(true);
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
