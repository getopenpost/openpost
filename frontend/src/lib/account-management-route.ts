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

export function rememberAccountManagementContinuation(continuation: AccountManagementContinuation) {
	if (!('localStorage' in globalThis)) return;
	try {
		globalThis.localStorage.setItem('oauth_workspace_id', continuation.workspaceID);
		if (continuation.mastodon?.instanceURL) {
			globalThis.localStorage.setItem(
				'oauth_mastodon_instance_url',
				continuation.mastodon.instanceURL
			);
			globalThis.localStorage.removeItem('oauth_mastodon_server');
		} else if (continuation.mastodon?.serverName) {
			globalThis.localStorage.setItem('oauth_mastodon_server', continuation.mastodon.serverName);
			globalThis.localStorage.removeItem('oauth_mastodon_instance_url');
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
	if (!('localStorage' in globalThis)) return;
	try {
		globalThis.localStorage.removeItem('oauth_workspace_id');
		globalThis.localStorage.removeItem('oauth_mastodon_server');
		globalThis.localStorage.removeItem('oauth_mastodon_instance_url');
	} catch {
		// Storage may be unavailable in hardened browser contexts; clearing is best-effort.
	}
}

export interface NormalizedAccountConnection {
	workspaceID: string;
	accountIDs: string[];
	openFreshComposer: boolean;
}

export function continuationHrefForNormalizedConnection(
	state: NormalizedAccountConnection
): string {
	if (state.openFreshComposer) {
		const q = new URLSearchParams({
			workspace_id: state.workspaceID,
			account_ids: state.accountIDs.join(',')
		});
		return `/?${q.toString()}`;
	}
	return accountManagementReturnHref();
}
