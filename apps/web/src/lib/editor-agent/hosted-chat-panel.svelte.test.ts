import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import type { EditorStyle } from './preferences';
import HostedChatPanel from './hosted-chat-panel.svelte';
import ImageEditorAssistant from '$lib/image-editor/components/image-editor-assistant.svelte';
import '../../routes/layout.css';

beforeEach(() => queryClient.clear());
afterEach(() => {
	vi.restoreAllMocks();
	queryClient.clear();
});

function availableAssistant() {
	vi.spyOn(client, 'GET').mockImplementation(async (path) => ({
		data: path === '/editor-agent/assistant/status' ? { available: true } : { styles: [] },
		response: new Response()
	}));
	return vi.spyOn(client, 'POST').mockResolvedValue({
		data: { reply: 'Done.', steps: [] },
		response: new Response()
	});
}

const connected = { workspaceId: 'workspace', projectId: 'first', sessionId: 'session' };

it('keeps image chat history and restores keyboard focus when the panel closes', async () => {
	availableAssistant();
	const screen = await render(ImageEditorAssistant, connected);
	const trigger = screen.getByRole('button', { name: 'Assistant', exact: true });
	await trigger.click();
	await expect.element(screen.getByRole('textbox')).toBeEnabled();
	await screen.getByRole('textbox').fill('Make the title blue');
	const composer = screen.getByRole('textbox').element();
	await screen.getByRole('button', { name: 'Run', exact: true }).click();
	await expect.element(screen.getByText('Done.', { exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'Close', exact: true }).click();
	await expect.element(trigger).toHaveFocus();
	await expect.element(composer).not.toBeVisible();
	await trigger.click();
	await expect.element(screen.getByText('Done.', { exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'Style', exact: true }).click();
	await expect
		.element(screen.getByRole('option', { name: 'Match project', exact: true }))
		.toBeVisible();
	await userEvent.keyboard('{Escape}');
	await expect.element(trigger).toHaveAttribute('aria-expanded', 'true');
	await userEvent.keyboard('{Escape}');
	await expect.element(trigger).toHaveFocus();
	await expect.element(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('confirms composed text without sending a paid request, then submits on Enter', async () => {
	const post = availableAssistant();
	const screen = await render(HostedChatPanel, connected);
	const input = screen.getByRole('textbox');
	await expect.element(input).toBeEnabled();
	await input.fill('Make the title blue');
	input.element().dispatchEvent(
		new KeyboardEvent('keydown', {
			key: 'Enter',
			isComposing: true,
			bubbles: true,
			cancelable: true
		})
	);
	await expect.element(input).toHaveValue('Make the title blue');
	expect(post).not.toHaveBeenCalled();
	await input.click();
	await userEvent.keyboard('{Enter}');
	await expect.element(screen.getByText('Done.', { exact: true })).toBeVisible();
	expect(post).toHaveBeenCalledOnce();
});

it('ignores a previous project preference refresh after its assistant has replied', async () => {
	availableAssistant();
	let finishRefresh!: (value: { data: { styles: EditorStyle[] }; response: Response }) => void;
	let firstReads = 0;
	vi.mocked(client.GET).mockImplementation(async (path) => {
		if (path === '/editor-agent/assistant/status')
			return { data: { available: true }, response: new Response() };
		firstReads++;
		if (firstReads === 2)
			return new Promise((resolve) => {
				finishRefresh = resolve;
			});
		return { data: { styles: [] }, response: new Response() };
	});
	vi.mocked(client.POST).mockResolvedValue({
		data: { reply: 'Old project edited.', steps: [{ operation: 'image_edit', result: {} }] },
		response: new Response()
	});
	const screen = await render(HostedChatPanel, connected);
	await expect.element(screen.getByRole('textbox')).toBeEnabled();
	await screen.getByRole('textbox').fill('Edit this design');
	await screen.getByRole('button', { name: 'Run', exact: true }).click();
	await expect.poll(() => firstReads).toBe(2);
	await expect.element(screen.getByRole('textbox')).toBeEnabled();
	await screen.rerender({ ...connected, projectId: 'second', sessionId: 'second-session' });
	finishRefresh({
		data: {
			styles: [
				{
					id: 'old-style',
					name: 'Previous project style',
					version: 1,
					context: '',
					editor_kind: 'image',
					source_instruction: '',
					definition: {
						captions: {},
						typography: {},
						guidance: [],
						interpretations: [],
						library: [],
						palette: []
					}
				}
			]
		},
		response: new Response()
	});
	await expect.poll(() => queryClient.isFetching()).toBe(0);
	await expect.element(screen.getByRole('textbox')).toBeEnabled();
	await expect
		.element(screen.getByText('Old project edited.', { exact: true }))
		.not.toBeInTheDocument();
	await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
	await screen.getByRole('button', { name: 'Style', exact: true }).click();
	await expect
		.element(screen.getByRole('option', { name: 'Match project', exact: true }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('option', { name: 'Previous project style (v1)', exact: true }))
		.not.toBeInTheDocument();
});

it('explains the paid plan restriction and prevents submitting a free request', async () => {
	const post = availableAssistant();
	vi.mocked(client.GET).mockResolvedValue({
		data: { available: false, reason: 'paid_plan_required' },
		response: new Response()
	});
	const screen = await render(HostedChatPanel, connected);
	await expect
		.element(screen.getByText('An active paid plan is required.', { exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('textbox')).toBeDisabled();
	await expect.element(screen.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
	expect(post).not.toHaveBeenCalled();
});

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
