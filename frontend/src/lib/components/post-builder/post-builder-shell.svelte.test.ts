import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { postBuilderCopy, type PostBuilderClient, type PostBuilderRun } from '$lib/post-builder';
import PostBuilderShell from './post-builder-shell.svelte';

function client(): PostBuilderClient {
	return {
		create: vi.fn(),
		load: vi.fn(),
		cancel: vi.fn(),
		retry: vi.fn(),
		commit: vi.fn()
	};
}

describe('PostBuilderShell ready result', () => {
	it('unlocks the saved source when the user starts another build', async () => {
		const onReset = vi.fn();
		const readyRun: PostBuilderRun = {
			id: 'run-1',
			phase: 'ready',
			result: {
				publicationId: '',
				thesis: 'A smaller product can be a better product.',
				destinationDecisions: [
					{
						accountId: 'account-1',
						platform: 'x',
						accountLabel: '@rodrigo',
						status: 'included',
						formatLabel: 'x.thread',
						objective: 'shares',
						archetype: 'technical_opinion',
						preview: 'Deleting code was the feature.'
					}
				]
			}
		};
		const screen = await render(PostBuilderShell, {
			props: {
				workspaceId: 'workspace-1',
				client: client(),
				initialRun: readyRun,
				sourceText: 'I removed 15,000 lines.',
				selectedAccountIds: ['account-1'],
				showCreationModeSwitch: false,
				copy: postBuilderCopy(),
				onReset
			}
		});

		await expect.element(screen.getByText('Deleting code was the feature.')).toBeVisible();
		await expect.element(screen.getByText('x.thread · shares · technical opinion')).toBeVisible();
		await screen.getByRole('button', { name: 'Build another' }).click();

		expect(onReset).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('textbox', { name: 'What happened?' })).toBeEnabled();
		await expect.element(screen.getByRole('button', { name: 'Build post' })).toBeVisible();
		await expect.element(screen.getByTestId('post-builder-result')).not.toBeInTheDocument();
	});
});
