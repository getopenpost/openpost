import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import TelegramConnectionDialog from './telegram-connection-dialog.svelte';
import '../../routes/layout.css';

afterEach(() => vi.restoreAllMocks());

it('binds a one-time command to the selected workspace and chat', async () => {
	const post = vi.spyOn(client, 'POST').mockResolvedValue({
		data: {
			code: '/connect one-time-test-command',
			bot_username: 'openpost_test_bot',
			expires_at: '2026-09-08T23:59:00Z'
		},
		response: new Response()
	});
	const onRefresh = vi.fn().mockResolvedValue(undefined);
	const onClose = vi.fn();
	const screen = await render(TelegramConnectionDialog, {
		workspaceID: 'workspace-telegram',
		onRefresh,
		onClose
	});
	await screen.getByRole('textbox', { name: 'Telegram chat ID' }).fill('-1001234567890');
	await screen.getByRole('button', { name: 'Get connection command' }).click();
	expect(post).toHaveBeenCalledWith('/accounts/telegram/connection-code', {
		body: {
			workspace_id: 'workspace-telegram',
			expected_chat_id: '-1001234567890'
		}
	});
	await expect
		.element(screen.getByRole('textbox', { name: 'Connection command' }))
		.toHaveValue('/connect one-time-test-command');
	await expect
		.element(screen.getByRole('link', { name: '@openpost_test_bot' }))
		.toHaveAttribute('href', 'https://t.me/openpost_test_bot');
	expect(onClose).not.toHaveBeenCalled();
	await screen.getByRole('button', { name: 'Reload accounts' }).click();
	expect(onRefresh).toHaveBeenCalledOnce();
	expect(onClose).toHaveBeenCalledOnce();
});

it('keeps the chat input and shows the provider refusal when issuance fails', async () => {
	vi.spyOn(client, 'POST').mockResolvedValue({
		error: { detail: 'telegram connections are unavailable' },
		response: new Response(null, { status: 503 })
	});
	const screen = await render(TelegramConnectionDialog, {
		workspaceID: 'workspace-telegram',
		onRefresh: vi.fn(),
		onClose: vi.fn()
	});
	await screen.getByRole('textbox', { name: 'Telegram chat ID' }).fill('-1001234567890');
	await screen.getByRole('button', { name: 'Get connection command' }).click();
	await expect
		.element(screen.getByRole('alert'))
		.toHaveTextContent('telegram connections are unavailable');
	await expect
		.element(screen.getByRole('textbox', { name: 'Telegram chat ID' }))
		.toHaveValue('-1001234567890');
	await expect
		.element(screen.getByRole('textbox', { name: 'Connection command' }))
		.not.toBeInTheDocument();
});
