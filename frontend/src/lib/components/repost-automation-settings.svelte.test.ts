import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import { client, type User } from '$lib/api/client';
import { schedulingQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import RepostAutomationSettings from './repost-automation-settings.svelte';

type RepostSettings = components['schemas']['SettingsResponse'];

const putMock = vi.spyOn(client, 'PUT');
const deleteMock = vi.spyOn(client, 'DELETE');
const getMock = vi.spyOn(client, 'GET');

describe('repost automation mutation ownership', () => {
	beforeEach(() => {
		queryClient.clear();
		putMock.mockReset();
		deleteMock.mockReset();
		getMock.mockReset();
		auth.setUser(user('user-a'));
	});

	it('does not project an old save into a new Workspace for the same actor', async () => {
		const save = deferred<{ data: RepostSettings; error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		putMock.mockReturnValue(save.promise as never);
		queryClient.setQueryData(
			schedulingQueryKeys.repostAutomation('workspace-a'),
			repostSettings('workspace-a', 'Workspace A rule')
		);

		const screen = await render(RepostAutomationSettings, { workspaceID: 'workspace-a' });
		const ruleName = screen.getByRole('textbox', { name: 'Rule name' });
		await expect.element(ruleName).toHaveValue('Workspace A rule');
		await ruleName.fill('Edited Workspace A rule');
		await screen.getByRole('button', { name: 'Save changes' }).click();
		expect(putMock).toHaveBeenCalledWith('/repost-automation', {
			body: {
				workspace_id: 'workspace-a',
				policies: [expect.objectContaining({ name: 'Edited Workspace A rule' })]
			}
		});

		const workspaceB = repostSettings('workspace-b', 'Workspace B rule');
		queryClient.setQueryData(schedulingQueryKeys.repostAutomation('workspace-b'), workspaceB);
		await screen.rerender({ workspaceID: 'workspace-b' });
		await expect.element(ruleName).toHaveValue('Workspace B rule');

		save.resolve({
			data: repostSettings('workspace-a', 'Saved Workspace A rule'),
			error: undefined,
			response: new Response(null, { status: 200 })
		});

		await expect.element(ruleName).toHaveValue('Workspace B rule');
		expect(queryClient.getQueryData(schedulingQueryKeys.repostAutomation('workspace-b'))).toEqual(
			workspaceB
		);
	});

	it('does not refresh or report an old grant revocation in a new Workspace', async () => {
		const revoke = deferred<{ error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		deleteMock.mockReturnValue(revoke.promise as never);
		const workspaceA = repostSettings('workspace-a', 'Workspace A rule');
		workspaceA.grants = [grant('grant-a')];
		queryClient.setQueryData(schedulingQueryKeys.repostAutomation('workspace-a'), workspaceA);

		const screen = await render(RepostAutomationSettings, { workspaceID: 'workspace-a' });
		await screen.getByRole('button', { name: 'Revoke access' }).click();
		await screen.getByRole('dialog').getByRole('button', { name: 'Revoke access' }).click();
		expect(deleteMock).toHaveBeenCalledWith('/repost-account-grants/{grant_id}', {
			params: {
				path: { grant_id: 'grant-a' },
				query: { workspace_id: 'workspace-a' }
			}
		});

		const workspaceB = repostSettings('workspace-b', 'Workspace B rule');
		queryClient.setQueryData(schedulingQueryKeys.repostAutomation('workspace-b'), workspaceB);
		// SAFETY: The fixture contains every response field consumed by the component.
		getMock.mockResolvedValue({
			data: workspaceB,
			error: undefined,
			response: new Response(null, { status: 200 })
		} as never);
		await screen.rerender({ workspaceID: 'workspace-b' });
		await expect
			.element(screen.getByRole('textbox', { name: 'Rule name' }))
			.toHaveValue('Workspace B rule');

		revoke.resolve({ error: undefined, response: new Response(null, { status: 204 }) });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(getMock).not.toHaveBeenCalled();
		expect(
			queryClient.getQueryState(schedulingQueryKeys.repostAutomation('workspace-a'))?.isInvalidated
		).toBe(true);
		expect(queryClient.getQueryData(schedulingQueryKeys.repostAutomation('workspace-b'))).toEqual(
			workspaceB
		);
	});
});

function repostSettings(workspaceID: string, ruleName: string): RepostSettings {
	return {
		workspace_id: workspaceID,
		can_manage: true,
		accounts: [
			{
				id: `${workspaceID}-account`,
				workspace_id: workspaceID,
				workspace_name: workspaceID,
				username: workspaceID,
				platform: 'x',
				cross_workspace: false,
				grant_active: false,
				grant_required: false,
				supports_repost: true
			}
		],
		grants: [],
		policies: [
			{
				id: `${workspaceID}-policy`,
				name: ruleName,
				enabled: true,
				source_account_ids: [],
				target_account_ids: [`${workspaceID}-account`],
				rule: {
					delay_seconds: 0,
					evaluation_window_seconds: 3600,
					threshold_mode: 'all',
					min_likes: 0,
					min_comments: 0,
					min_reposts: 0,
					min_views: 0,
					require_plateau: false,
					plateau_checks: 2
				}
			}
		],
		supported_platforms: ['x']
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function grant(id: string): components['schemas']['GrantResponse'] {
	return {
		id,
		direction: 'outbound',
		platform: 'x',
		source_workspace_id: 'workspace-a',
		source_workspace_name: 'Workspace A',
		target_workspace_id: 'workspace-b',
		target_workspace_name: 'Workspace B',
		target_account_id: 'account-b',
		target_username: 'target',
		created_at: '2026-09-01T10:00:00Z'
	};
}

function user(id: string): User {
	return {
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
