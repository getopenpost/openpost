import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceSettingsQueryKeys } from '@openpost/query-catalog';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { ui } from '$lib/stores/ui.svelte';
import WorkspaceSetupGuide from './workspace-setup-guide.svelte';

const mocks = { get: vi.fn() };
vi.spyOn(client, 'GET').mockImplementation(mocks.get);

describe('WorkspaceSetupGuide', () => {
	beforeEach(() => {
		mocks.get.mockReset();
		queryClient.clear();
	});

	it('shows the server-projected next step while reusing cached reads', async () => {
		mocks.get.mockResolvedValue({
			data: {
				visible: true,
				activated: false,
				completed_steps: 3,
				total_steps: 4,
				next_step: 'destination',
				next_action: 'connect_destination',
				action_href: '/settings?tab=accounts',
				steps: [
					{ id: 'workspace', completed: true },
					{ id: 'destination', completed: false },
					{ id: 'composition', completed: true },
					{ id: 'publication', completed: true }
				]
			}
		});

		const screen = await render(WorkspaceSetupGuide, {
			props: { workspaceID: 'workspace-1', context: 'composer' }
		});
		const guide = screen.getByTestId('workspace-setup-guide-composer');
		await expect.element(guide).toBeVisible();
		await expect
			.element(screen.getByRole('link', { name: 'Connect an account' }))
			.toHaveAttribute('href', '/accounts');
		expect(mocks.get).toHaveBeenCalledWith('/workspaces/{id}/setup', {
			params: { path: { id: 'workspace-1' } },
			signal: expect.any(AbortSignal)
		});

		window.dispatchEvent(new Event('focus'));
		await expect.poll(() => mocks.get).toHaveBeenCalledTimes(1);
	});

	it('stays absent after server-projected activation', async () => {
		mocks.get.mockResolvedValue({
			data: {
				visible: false,
				activated: true,
				next_action: 'create_publication',
				action_href: '/',
				completed_steps: 3,
				total_steps: 3,
				steps: []
			}
		});

		const screen = await render(WorkspaceSetupGuide, {
			props: { workspaceID: 'workspace-1', context: 'composer' }
		});
		await expect
			.poll(
				() => queryClient.getQueryState(workspaceSettingsQueryKeys.setup('workspace-1'))?.status
			)
			.toBe('success');
		await expect
			.element(screen.getByTestId('workspace-setup-guide-composer'))
			.not.toBeInTheDocument();
	});

	it('refreshes its projection after workspace state changes', async () => {
		mocks.get
			.mockResolvedValueOnce({
				data: {
					visible: true,
					activated: false,
					completed_steps: 2,
					total_steps: 3,
					next_action: 'connect_destination',
					action_href: '/accounts',
					steps: []
				}
			})
			.mockResolvedValueOnce({
				data: {
					visible: false,
					activated: true,
					next_action: 'create_publication',
					action_href: '/',
					completed_steps: 3,
					total_steps: 3,
					steps: []
				}
			});

		const screen = await render(WorkspaceSetupGuide, {
			props: { workspaceID: 'workspace-1', context: 'composer' }
		});
		await expect.element(screen.getByTestId('workspace-setup-guide-composer')).toBeVisible();
		ui.refreshWorkspaceSetup();
		await expect.poll(() => mocks.get).toHaveBeenCalledTimes(2);
		expect(mocks.get).toHaveBeenNthCalledWith(2, '/workspaces/{id}/setup', {
			params: { path: { id: 'workspace-1' } },
			signal: expect.any(AbortSignal)
		});
		await expect
			.poll(() => queryClient.getQueryData(workspaceSettingsQueryKeys.setup('workspace-1')))
			.toMatchObject({ visible: false, action_href: '/' });
		await expect
			.element(screen.getByTestId('workspace-setup-guide-composer'))
			.not.toBeInTheDocument();
	});
});
