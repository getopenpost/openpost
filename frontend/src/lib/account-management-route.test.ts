import { describe, expect, it } from 'vitest';
import {
	continuationHrefForNormalizedConnection,
	interpretAccountManagementURL
} from './account-management-route';

describe('account management route URL interpretation', () => {
	it('keeps Settings navigation in place while consuming scoped OAuth feedback', () => {
		expect(
			interpretAccountManagementURL(
				new URL(
					'https://openpost.test/settings?tab=accounts&oauth_status=cancelled&workspace_id=workspace-62&source=help'
				)
			)
		).toEqual({
			feedback: { kind: 'oauth_cancelled' },
			workspaceID: 'workspace-62',
			cleanHref: '/settings?tab=accounts&source=help'
		});
	});

	it('preserves the Settings tab and maps legacy errors to bounded one-time feedback', () => {
		expect(
			interpretAccountManagementURL(
				new URL('https://openpost.test/settings?tab=accounts&error=Provider%20unavailable')
			)
		).toEqual({
			feedback: { kind: 'oauth_failed' },
			workspaceID: '',
			cleanHref: '/settings?tab=accounts'
		});
	});

	it('does not consume unrelated Settings URL state', () => {
		expect(
			interpretAccountManagementURL(new URL('https://openpost.test/settings?tab=accounts#accounts'))
		).toEqual({
			feedback: null,
			workspaceID: '',
			cleanHref: '/settings?tab=accounts#accounts'
		});
	});
});

describe('normalized account connection continuation', () => {
	it('opens the composer after the first destination is connected', () => {
		expect(
			continuationHrefForNormalizedConnection({
				workspaceID: 'workspace-62',
				accountIDs: ['account-9'],
				openFreshComposer: true
			})
		).toBe('/?workspace_id=workspace-62&account_ids=account-9');
	});

	it('returns later connections to Social accounts in Settings', () => {
		expect(
			continuationHrefForNormalizedConnection({
				workspaceID: 'workspace-62',
				accountIDs: ['account-9'],
				openFreshComposer: false
			})
		).toBe('/settings?tab=accounts');
	});
});
