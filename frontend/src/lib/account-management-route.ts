import type {
	AccountManagementContinuation,
	AccountManagementFeedback,
	AccountManagementMode
} from '$lib/account-management';
import { m } from '$lib/paraglide/messages';

export type AccountManagementURLFeedback = { kind: 'oauth_cancelled' } | { kind: 'oauth_failed' };

const returnModeKey = 'oauth_account_management_mode';

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
	continuation: AccountManagementContinuation,
	mode: AccountManagementMode
) {
	localStorage.setItem(returnModeKey, mode);
	localStorage.setItem('oauth_workspace_id', continuation.workspaceID);
	if (continuation.mastodon?.instanceURL) {
		localStorage.setItem('oauth_mastodon_instance_url', continuation.mastodon.instanceURL);
		localStorage.removeItem('oauth_mastodon_server');
	} else if (continuation.mastodon?.serverName) {
		localStorage.setItem('oauth_mastodon_server', continuation.mastodon.serverName);
		localStorage.removeItem('oauth_mastodon_instance_url');
	}
}

export function accountManagementReturnMode(): AccountManagementMode {
	return localStorage.getItem(returnModeKey) === 'direct' ? 'direct' : 'settings';
}

export function accountManagementReturnHref(
	mode = accountManagementReturnMode(),
	feedback?: 'failed' | 'cancelled',
	workspaceID = ''
): string {
	const params = new URLSearchParams();
	if (mode === 'settings') params.set('tab', 'accounts');
	if (feedback) params.set('oauth_status', feedback);
	if (workspaceID) params.set('workspace_id', workspaceID);
	const query = params.toString();
	return `${mode === 'direct' ? '/accounts' : '/settings'}${query ? `?${query}` : ''}`;
}

export function clearAccountManagementContinuation() {
	localStorage.removeItem(returnModeKey);
	localStorage.removeItem('oauth_workspace_id');
	localStorage.removeItem('oauth_mastodon_server');
	localStorage.removeItem('oauth_mastodon_instance_url');
}
