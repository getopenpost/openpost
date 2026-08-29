import type {
	AccountManagementContinuation,
	AccountManagementFeedback
} from '$lib/account-management';
import { m } from '$lib/paraglide/messages';

export type AccountManagementURLFeedback = { kind: 'oauth_cancelled' } | { kind: 'oauth_failed' };

export interface AccountManagementURLState {
	feedback: AccountManagementURLFeedback | null;
	workspaceID: string;
	cleanHref: string;
}

export function interpretAccountManagementURL(url: URL): AccountManagementURLState {
	const params = new URLSearchParams(url.searchParams);
	const oauthStatus = params.get('oauth_status');
	const hasLegacyError = params.has('error');
	const workspaceID = params.get('workspace_id') ?? '';
	let feedback: AccountManagementURLFeedback | null = null;

	if (oauthStatus === 'cancelled') feedback = { kind: 'oauth_cancelled' };
	else if (oauthStatus) feedback = { kind: 'oauth_failed' };
	else if (hasLegacyError) feedback = { kind: 'oauth_failed' };

	if (feedback) {
		params.delete('oauth_status');
		params.delete('workspace_id');
		params.delete('error');
	}

	const search = params.toString();
	return {
		feedback,
		workspaceID: feedback ? workspaceID : '',
		cleanHref: `${url.pathname}${search ? `?${search}` : ''}${url.hash}`
	};
}

export function presentAccountManagementFeedback(
	value: AccountManagementURLFeedback | null
): AccountManagementFeedback | null {
	if (!value) return null;
	if (value.kind === 'oauth_cancelled') {
		return { tone: 'info', message: m.accounts_oauth_cancelled() };
	}
	return { tone: 'error', message: m.accounts_oauth_failed() };
}

export function rememberAccountManagementContinuation(
	continuation: AccountManagementContinuation
) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem('oauth_workspace_id', continuation.workspaceID);
		if (continuation.mastodon?.instanceURL) {
			localStorage.setItem('oauth_mastodon_instance_url', continuation.mastodon.instanceURL);
			localStorage.removeItem('oauth_mastodon_server');
		} else if (continuation.mastodon?.serverName) {
			localStorage.setItem('oauth_mastodon_server', continuation.mastodon.serverName);
			localStorage.removeItem('oauth_mastodon_instance_url');
		}
	} catch {
		// Storage may be unavailable in hardened browser contexts; continuation is best-effort.
	}
}

export function accountManagementReturnHref(
	feedback?: 'failed' | 'cancelled',
	workspaceID = ''
): string {
	const params = new URLSearchParams();
	params.set('tab', 'accounts');
	if (feedback) params.set('oauth_status', feedback);
	if (workspaceID) params.set('workspace_id', workspaceID);
	const query = params.toString();
	return `/settings${query ? `?${query}` : ''}`;
}

export function clearAccountManagementContinuation() {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem('oauth_workspace_id');
		localStorage.removeItem('oauth_mastodon_server');
		localStorage.removeItem('oauth_mastodon_instance_url');
	} catch {
		// Storage may be unavailable in hardened browser contexts; clearing is best-effort.
	}
}

export interface AccountSetupState {
	workspaceID: string;
	accountIDs: string[];
	newAccountIDs: string[];
	openFreshComposer: boolean;
}

export function accountSetupHref(state: AccountSetupState): string {
	const params = new URLSearchParams();
	params.set('workspace_id', state.workspaceID);
	if (state.accountIDs.length) params.set('account_ids', state.accountIDs.join(','));
	if (state.newAccountIDs.length) params.set('new_account_ids', state.newAccountIDs.join(','));
	if (state.openFreshComposer) params.set('open_fresh_composer', 'true');
	return `/accounts/setup?${params.toString()}`;
}

export function interpretAccountSetupURL(url: URL): AccountSetupState | null {
	const workspaceID = url.searchParams.get('workspace_id') ?? '';
	if (!workspaceID) return null;
	const accountIDs = (url.searchParams.get('account_ids') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const newAccountIDs = (url.searchParams.get('new_account_ids') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const openFreshComposer = url.searchParams.get('open_fresh_composer') === 'true';
	return { workspaceID, accountIDs, newAccountIDs, openFreshComposer };
}

export function continuationHrefForNormalizedConnection(
	state: AccountSetupState & { featureSetupRequired: boolean }
): string {
	if (state.featureSetupRequired && state.newAccountIDs.length > 0) {
		return accountSetupHref(state);
	}
	if (state.openFreshComposer) {
		const q = new URLSearchParams({
			workspace_id: state.workspaceID,
			account_ids: state.accountIDs.join(',')
		});
		return `/?${q.toString()}`;
	}
	return accountManagementReturnHref();
}
