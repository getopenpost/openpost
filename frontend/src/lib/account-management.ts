import type { Workspace } from '$lib/api/client';

export type AccountManagementFeedback = {
	message: string;
	tone: 'error' | 'success' | 'warning' | 'info';
};
export type AccountManagementLinks = {
	createPublicationHref: string;
	createWorkspaceHref: string;
	billingHref: string;
	mastodonCallbackHref: string;
};
export type AccountManagementContinuation =
	| {
			kind: 'external-oauth';
			url: string;
			workspaceID: string;
			mastodon?: { serverName?: string; instanceURL?: string };
	  }
	| {
			kind: 'mastodon-code';
			href: string;
			workspaceID: string;
			mastodon: { serverName?: string; instanceURL?: string };
	  };

export interface AccountManagementProps {
	workspace: Workspace | null;
	workspaces: Workspace[];
	links: AccountManagementLinks;
	loading?: boolean;
	showInstanceSettings?: boolean;
	feedback?: AccountManagementFeedback | null;
	onFeedbackDismiss?: () => void;
	onContinue: (continuation: AccountManagementContinuation) => void;
	onAccountsChanged: () => void;
}
