import type {
	AccountManagementContinuation,
	AccountManagementFeedback
} from '$lib/account-management';
import { m } from '$lib/paraglide/messages';

export type AccountManagementURLFeedback =
	| { kind: 'oauth_cancelled' }
	| { kind: 'oauth_failed' }
	| { kind: 'facebook_no_pages' }
	| { kind: 'instagram_no_page_linked_account' };

export interface AccountManagementURLState {
	feedback: AccountManagementURLFeedback | null;
	workspaceID: string;
	cleanHref: string;
}

export function interpretAccountManagementURL(url: URL): AccountManagementURLState {
	const params = new URLSearchParams(url.searchParams);
	const oauthStatus = params.get('oauth_status');
	const oauthReason = params.get('oauth_reason');
	const hasLegacyError = params.has('error');
	const workspaceID = params.get('workspace_id') ?? '';
	let feedback: AccountManagementURLFeedback | null = null;

	if (oauthStatus === 'failed' && oauthReason === 'facebook_no_pages') {
		feedback = { kind: 'facebook_no_pages' };
	} else if (oauthStatus === 'failed' && oauthReason === 'instagram_no_page_linked_account') {
		feedback = { kind: 'instagram_no_page_linked_account' };
	} else if (oauthStatus === 'cancelled') feedback = { kind: 'oauth_cancelled' };
	else if (oauthStatus) feedback = { kind: 'oauth_failed' };
	else if (hasLegacyError) feedback = { kind: 'oauth_failed' };

	if (feedback) {
		params.delete('oauth_status');
		params.delete('oauth_reason');
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
	if (value.kind === 'facebook_no_pages') {
		return { tone: 'error', message: m.accounts_oauth_facebook_no_pages() };
	}
	if (value.kind === 'instagram_no_page_linked_account') {
		return { tone: 'error', message: m.accounts_oauth_instagram_no_page_linked_account() };
	}
	return { tone: 'error', message: m.accounts_oauth_failed() };
}

export function rememberAccountManagementContinuation(continuation: AccountManagementContinuation) {
	if (!('localStorage' in globalThis)) return;
	try {
		globalThis.localStorage.setItem('oauth_workspace_id', continuation.workspaceID);
		const fediverse = continuation.fediverse;
		if (fediverse?.instanceURL) {
			globalThis.localStorage.setItem('oauth_fediverse_provider', fediverse.provider);
			globalThis.localStorage.setItem('oauth_fediverse_instance_url', fediverse.instanceURL);
			globalThis.localStorage.removeItem('oauth_fediverse_server');
		} else if (fediverse?.serverName) {
			globalThis.localStorage.setItem('oauth_fediverse_provider', fediverse.provider);
			globalThis.localStorage.setItem('oauth_fediverse_server', fediverse.serverName);
			globalThis.localStorage.removeItem('oauth_fediverse_instance_url');
		}
		// Legacy Mastodon-only keys are left in place for callbacks already in flight.
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
		globalThis.localStorage.removeItem('oauth_fediverse_provider');
		globalThis.localStorage.removeItem('oauth_fediverse_server');
		globalThis.localStorage.removeItem('oauth_fediverse_instance_url');
	} catch {
		// Storage may be unavailable in hardened browser contexts; clearing is best-effort.
	}
}

export type FediverseCodeContinuation = {
	provider: 'mastodon' | 'pixelfed';
	serverName: string;
	instanceURL: string;
};

export function readFediverseCodeContinuation():
	| (FediverseCodeContinuation & {
			workspaceID: string;
	  })
	| null {
	if (!('localStorage' in globalThis)) return null;
	try {
		const workspaceID = globalThis.localStorage.getItem('oauth_workspace_id') ?? '';
		const provider =
			globalThis.localStorage.getItem('oauth_fediverse_provider') ??
			(globalThis.localStorage.getItem('oauth_mastodon_server') ||
			globalThis.localStorage.getItem('oauth_mastodon_instance_url')
				? 'mastodon'
				: '');
		const serverName =
			globalThis.localStorage.getItem('oauth_fediverse_server') ??
			globalThis.localStorage.getItem('oauth_mastodon_server') ??
			'';
		const instanceURL =
			globalThis.localStorage.getItem('oauth_fediverse_instance_url') ??
			globalThis.localStorage.getItem('oauth_mastodon_instance_url') ??
			'';
		if (provider !== 'mastodon' && provider !== 'pixelfed') return null;
		return { provider, workspaceID, serverName, instanceURL };
	} catch {
		return null;
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
