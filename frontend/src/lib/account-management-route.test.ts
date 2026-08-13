import { describe, expect, it } from 'vitest';
import { interpretAccountManagementURL } from './account-management-route';

describe('account management route URL interpretation', () => {
	it('keeps direct navigation in place while consuming scoped OAuth feedback', () => {
		expect(
			interpretAccountManagementURL(
				new URL(
					'https://openpost.test/accounts?oauth_status=cancelled&workspace_id=workspace-62&source=help'
				)
			)
		).toEqual({
			feedback: { kind: 'oauth_cancelled' },
			workspaceID: 'workspace-62',
			cleanHref: '/accounts?source=help'
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
