import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import HostedChatPanel from './hosted-chat-panel.svelte';

it('shows an unavailable assistant without waiting for a guest workspace', async () => {
	const screen = await render(HostedChatPanel, {
		workspaceId: '',
		projectId: 'local-project',
		sessionId: null
	});
	await expect.element(screen.getByText('Assistant unavailable.', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('Loading...', { exact: true })).not.toBeInTheDocument();
	await expect
		.element(screen.getByRole('button', { name: 'Preferences', exact: true }))
		.toBeDisabled();
});
