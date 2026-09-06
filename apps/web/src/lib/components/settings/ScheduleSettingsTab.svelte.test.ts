import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { schedulingQueryKeys, type PostingSchedule } from '@openpost/query-catalog';
import { client, type User, type Workspace } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import ScheduleSettingsTab from './ScheduleSettingsTab.svelte';

const getMock = vi.spyOn(client, 'GET');
const deleteMock = vi.spyOn(client, 'DELETE');

describe('posting schedule mutation ownership', () => {
	beforeEach(async () => {
		await page.viewport(1280, 900);
		queryClient.clear();
		getMock.mockReset();
		deleteMock.mockReset();
		auth.setUser(user('user-a'));
		selectWorkspace('workspace-a');
		queryClient.setQueryData(schedulingQueryKeys.postingSchedules('workspace-a'), [
			schedule('workspace-a')
		]);
		getMock.mockImplementation((path, request) => {
			if (path !== '/posting-schedules') throw new Error(`Unexpected GET ${path}`);
			const workspaceID = request?.params?.query?.workspace_id ?? '';
			// SAFETY: The fixture contains every response field consumed by the component.
			return Promise.resolve(response([schedule(workspaceID)])) as never;
		});
	});

	it('does not refresh or report an old row deletion in a new Workspace', async () => {
		const deletion = deferred<{ error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		deleteMock.mockReturnValue(deletion.promise as never);
		const screen = await render(ScheduleSettingsTab);
		const removeButton = [...screen.container.querySelectorAll<HTMLButtonElement>('button')].find(
			(button) => button.ariaLabel === 'Remove the 9:00 AM row' && button.offsetParent !== null
		);
		expect(removeButton).toBeDefined();
		removeButton?.click();
		await expect.element(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
		expect(deleteMock).toHaveBeenCalledWith('/posting-schedules/{id}', {
			params: { path: { id: 'shared-schedule' } }
		});

		queryClient.setQueryData(schedulingQueryKeys.postingSchedules('workspace-b'), [
			schedule('workspace-b')
		]);
		selectWorkspace('workspace-b');
		await new Promise((resolve) => setTimeout(resolve, 20));
		const workspaceBReads = scheduleReadCount('workspace-b');

		deletion.resolve({ error: undefined, response: new Response(null, { status: 204 }) });
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(scheduleReadCount('workspace-b')).toBe(workspaceBReads);
	});

	function scheduleReadCount(workspaceID: string) {
		return getMock.mock.calls.filter(
			([path, request]) =>
				path === '/posting-schedules' && request?.params?.query?.workspace_id === workspaceID
		).length;
	}
});

function response<T>(data: T) {
	return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

function schedule(workspaceID: string): PostingSchedule {
	return {
		id: 'shared-schedule',
		workspace_id: workspaceID,
		day_of_week: 1,
		local_day_of_week: 1,
		local_hour: 9,
		local_minute: 0,
		utc_hour: 9,
		utc_minute: 0,
		label: '',
		is_active: true,
		created_at: '2026-09-01T10:00:00Z'
	};
}

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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
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
