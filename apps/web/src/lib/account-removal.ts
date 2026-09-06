import type { SocialAccount } from '$lib/api/client';

export type AccountRemovalKind = 'disconnect-destination' | 'remove-grant';

type GrantSummary = Pick<SocialAccount, 'grant_destination_count' | 'shared_grant'>;

export function grantDestinationCount(account: GrantSummary): number {
	const reportedCount = Number.isFinite(account.grant_destination_count)
		? Math.max(1, Math.floor(account.grant_destination_count))
		: 1;
	return account.shared_grant ? Math.max(2, reportedCount) : reportedCount;
}

export function accountRemovalKinds(account: GrantSummary): AccountRemovalKind[] {
	return grantDestinationCount(account) > 1
		? ['disconnect-destination', 'remove-grant']
		: ['remove-grant'];
}
