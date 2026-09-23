import { describe, expect, it } from 'vitest';
import {
	continuationHrefForNormalizedConnection,
	interpretAccountManagementURL,
	presentAccountManagementFeedback
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

	it('shows an actionable error when Facebook returns no manageable Pages', () => {
		const state = interpretAccountManagementURL(
			new URL(
				'https://openpost.test/settings?tab=accounts&oauth_status=failed&oauth_reason=facebook_no_pages&workspace_id=workspace-62'
			)
		);

		expect(state).toEqual({
			feedback: { kind: 'facebook_no_pages' },
			workspaceID: 'workspace-62',
			cleanHref: '/settings?tab=accounts'
		});
		expect(presentAccountManagementFeedback(state.feedback)).toEqual({
			tone: 'error',
			message:
				'Facebook did not share any manageable Pages. Create a Page, request Page access, or check the Facebook app permissions, then try again.'
		});
	});

	it('explains when Instagram has no professional account linked to a managed Page', () => {
		const state = interpretAccountManagementURL(
			new URL(
				'https://openpost.test/settings?tab=accounts&oauth_status=failed&oauth_reason=instagram_no_page_linked_account&workspace_id=workspace-62'
			)
		);

		expect(state).toEqual({
			feedback: { kind: 'instagram_no_page_linked_account' },
			workspaceID: 'workspace-62',
			cleanHref: '/settings?tab=accounts'
		});
		expect(presentAccountManagementFeedback(state.feedback)).toEqual({
			tone: 'error',
			message:
				'Instagram needs a Business or Creator account linked to a Facebook Page you can manage. Link the account to a Page, check your Page access, then reconnect.'
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
