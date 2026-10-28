import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import type { components } from '$lib/api/types';
import { schedulingQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import ComposerRepostControl from './composer-repost-control.svelte';

type RepostSettings = components['schemas']['SettingsResponse'];
type RepostOverride = components['schemas']['Override'];
type RepostRule = components['schemas']['Rule'];

function repostAccount(id: string, username: string) {
	return {
		id,
		workspace_id: 'workspace-a',
		workspace_name: 'Workspace A',
		username,
		platform: 'x',
		cross_workspace: false,
		grant_active: false,
		grant_required: false,
		supports_repost: true
	};
}

function defaultRule(): RepostRule {
	return {
		delay_seconds: 86400,
		evaluation_window_seconds: 604800,
		threshold_mode: 'all',
		min_likes: 0,
		min_comments: 0,
		min_reposts: 0,
		min_views: 0,
		require_plateau: false,
		plateau_checks: 2,
		stages: [{ delay_seconds: 86400, unrepost_previous: false }]
	};
}

describe('composer repost target picker', () => {
	beforeEach(() => {
		queryClient.clear();
		queryClient.setQueryData(schedulingQueryKeys.repostAutomation('workspace-a'), {
			workspace_id: 'workspace-a',
			can_manage: true,
			accounts: [repostAccount('account-a', 'alice'), repostAccount('account-b', 'bob')],
			grants: [],
			policies: [],
			supported_platforms: ['x']
		} satisfies RepostSettings);
	});

	async function openCustomPicker(value: RepostOverride, onChange = vi.fn()) {
		const screen = await render(
			ComposerRepostControl,
			{
				workspaceID: 'workspace-a',
				value,
				onChange
			},
			{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
		);
		await screen.getByRole('button', { name: 'Repost settings' }).click();
		return screen;
	}

	it('selecting all checks every target without changing picker order', async () => {
		const onChange = vi.fn();
		const value: RepostOverride = {
			mode: 'custom',
			target_account_ids: ['account-a'],
			rule: defaultRule()
		};
		const screen = await openCustomPicker(value, onChange);

		// A partial target selection reports a mixed select-all state before the click.
		await expect
			.element(screen.getByRole('checkbox', { name: 'Select all' }))
			.toHaveAttribute('aria-checked', 'mixed');

		await screen.getByRole('button', { name: 'All' }).click();
		expect(onChange).toHaveBeenCalled();
		// The adopting picker keeps its own wire contract: the full target list in picker order.
		expect(value.target_account_ids).toEqual(['account-a', 'account-b']);

		// Propagate the authored change the way a bound composer would.
		await screen.rerender({ workspaceID: 'workspace-a', value: { ...value }, onChange });
		await expect.element(screen.getByRole('checkbox', { name: '@alice, X' })).toBeChecked();
		await expect.element(screen.getByRole('checkbox', { name: '@bob, X' })).toBeChecked();
		await expect.element(screen.getByRole('checkbox', { name: 'Select all' })).toBeChecked();
	});
});
