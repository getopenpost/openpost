import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { notificationQueryKeys } from '@openpost/query-catalog';
import { userProfileDefaults } from '$lib/test-fixtures/user-profile';
import type { User, Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import { notificationInbox } from '$lib/stores/notifications.svelte';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import * as Sidebar from '$lib/components/ui/sidebar';
import NotificationBell from './notification-bell.svelte';

const UNREAD_COUNT = 3;

describe('notification bell unread badge', () => {
	beforeEach(() => {
		queryClient.clear();
		notificationInbox.clear();
		auth.setUser(user('user-a'));
		selectWorkspace('workspace-a');
		queryClient.setQueryData(notificationQueryKeys.inbox('workspace-a', 30), {
			pages: [{ items: [], unread_count: UNREAD_COUNT, next_cursor: '' }],
			pageParams: ['']
		});
	});

	it('keeps the unread badge presentational because the link label announces the count', async () => {
		const screen = await render(NotificationBell, {}, { wrapper: Sidebar.Provider });
		const link = screen.getByRole('link', { name: `Notifications, ${UNREAD_COUNT} unread` });
		await expect.element(link).toBeVisible();
		const badge = link.getByText(String(UNREAD_COUNT));
		// The badge sits inside an already-named link, so it must not carry its own
		// aria-label on a role-less span (silently ignored); it is hidden instead.
		await expect.element(badge).toHaveAttribute('aria-hidden', 'true');
		expect(
			screen.container.querySelector('[aria-label="3 unread notifications"]'),
			'Expected no nested labeled badge inside the named link'
		).toBeNull();
	});
});

function selectWorkspace(id: string) {
	workspaceCtx.currentWorkspace = workspace(id);
	workspaceCtx.settingsWorkspaceID = id;
	workspaceCtx.settings = {
		name: id,
		avatar_url: '',
		color: '#f97316',
		timezone: 'UTC',
		week_start: 1,
		random_delay_minutes: 0,
		slot_start_hour: 5,
		slot_end_hour: 23,
		slot_interval_minutes: 15
	};
}

function workspace(id: string): Workspace {
	return {
		id,
		name: id,
		avatar_url: '',
		can_edit: true,
		color: '#f97316',
		created_at: '2026-09-01T10:00:00Z',
		organization_id: 'organization-1',
		organization_name: 'Organization',
		role: 'admin',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
}

function user(id: string): User {
	return {
		...userProfileDefaults,
		id,
		email: `${id}@example.com`,
		username: id,
		public_profile_enabled: false,
		is_admin: false,
		is_managed: false,
		has_password: true,
		legal_acceptance_required: false,
		email_verified: true,
		created_at: '2026-09-01T10:00:00Z'
	};
}
