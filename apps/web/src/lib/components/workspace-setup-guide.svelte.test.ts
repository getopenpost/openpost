import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
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

	it('shows server-projected progress and only its authorized next action', async () => {
		mocks.get.mockResolvedValue({
			data: {
				visible: true,
				activated: false,
				completed_steps: 3,
				total_steps: 4,
				next_step: 'publication',
				next_action: 'create_publication',
				action_href: '/',
				steps: [
					{ id: 'workspace', completed: true },
					{ id: 'destination', completed: true },
					{ id: 'composition', completed: true },
					{ id: 'publication', completed: false }
				]
			}
		});

		const screen = await render(WorkspaceSetupGuide, {
			workspaceID: 'workspace-1'
		});
		const guide = screen.getByTestId('workspace-setup-guide-home');
		await expect.element(guide).toBeVisible();
		await expect.element(guide).toHaveTextContent('3 of 4 complete');
		await expect.element(guide).toHaveTextContent('Schedule or submit your first Publication');
		await expect
			.element(screen.getByRole('link', { name: 'Create a Publication' }))
			.toHaveAttribute('href', '/');
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
				completed_steps: 3,
				total_steps: 3,
				steps: []
			}
		});

		const screen = await render(WorkspaceSetupGuide, {
			workspaceID: 'workspace-1'
		});
		await expect.element(screen.getByTestId('workspace-setup-guide-home')).not.toBeInTheDocument();
	});

	it('refreshes its projection after workspace state changes', async () => {
		mocks.get
			.mockResolvedValueOnce({
				data: {
					visible: true,
					activated: false,
					completed_steps: 2,
					total_steps: 3,
					next_action: 'create_publication',
					action_href: '/',
					steps: []
				}
			})
			.mockResolvedValueOnce({
				data: {
					visible: false,
					activated: true,
					completed_steps: 3,
					total_steps: 3,
					steps: []
				}
			});

		const screen = await render(WorkspaceSetupGuide, {
			workspaceID: 'workspace-1'
		});
		await expect.element(screen.getByTestId('workspace-setup-guide-home')).toBeVisible();
		ui.refreshWorkspaceSetup();
		await expect.element(screen.getByTestId('workspace-setup-guide-home')).not.toBeInTheDocument();
	});
});
