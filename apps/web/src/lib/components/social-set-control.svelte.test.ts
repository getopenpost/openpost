import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import { client } from '$lib/api/client';
import { openPostQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import SocialSetControl from './social-set-control.svelte';

type SocialSet = components['schemas']['SocialSetResponse'];

const getMock = vi.spyOn(client, 'GET');
const postMock = vi.spyOn(client, 'POST');
const putMock = vi.spyOn(client, 'PUT');
const readWorkspaces: string[] = [];

describe('Social Set request ownership', () => {
	beforeEach(() => {
		queryClient.clear();
		getMock.mockReset();
		postMock.mockReset();
		putMock.mockReset();
		readWorkspaces.length = 0;
	});

	it('keeps and edits account defaults when a Social Set is saved', async () => {
		const existing = socialSet('workspace-a');
		existing.accounts = [
			{
				social_account_id: 'acc-1',
				platform: 'x',
				display_order: 0,
				default_output_profile: 'x.post',
				default_settings: { reply_settings: 'following' },
				default_segment_settings: {}
			}
		];
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), [existing]);
		installResolvedReads();
		postMock.mockImplementation((path) => {
			if (path !== '/capabilities/resolve') throw new Error(`Unexpected POST ${path}`);
			return Promise.resolve(
				response({ accounts: [{ account_id: 'acc-1', settings: [xReplySetting] }] })
			) as never;
		});
		putMock.mockImplementation(() => new Promise(() => {}) as never);
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [{ id: 'acc-1', platform: 'x', account_username: 'openpost' }] as never,
			capabilities: [{ provider: 'x', output_profile: 'x.post', label: 'Post' }] as never,
			selectedSetId: existing.id,
			onApply: vi.fn()
		});
		await openManager(screen);
		await screen.getByRole('button', { name: 'Edit post settings' }).click();
		const settingsDialog = screen.getByRole('dialog', { name: 'X settings' });
		await expect.element(settingsDialog).toBeVisible();
		await settingsDialog.getByRole('button', { name: /^(following|Who can reply)$/ }).click();
		await screen.getByRole('option', { name: 'mentionedUsers' }).click();
		await settingsDialog.getByRole('button', { name: 'Done' }).click();
		await screen
			.getByRole('dialog', { name: 'Manage Social Sets' })
			.getByRole('button', { name: 'Save' })
			.click();
		expect(putMock).toHaveBeenCalledWith('/social-sets/{id}', {
			params: { path: { id: existing.id } },
			body: {
				name: existing.name,
				is_default: false,
				accounts: [
					{
						social_account_id: 'acc-1',
						default_output_profile: 'x.post',
						default_settings: { reply_settings: 'mentionedUsers' },
						default_segment_settings: {}
					}
				]
			}
		});
	});

	it('uses account-resolved fields for bot and webhook Social Set presets', async () => {
		const existing = socialSet('workspace-a');
		existing.accounts = [
			{
				social_account_id: 'webhook',
				platform: 'discord',
				display_order: 0,
				default_settings: { channel_id: 'stale' }
			},
			{ social_account_id: 'bot', platform: 'discord', display_order: 1 }
		];
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), [existing]);
		installResolvedReads();
		postMock.mockImplementation((path, request: { body?: { account_ids?: string[] } }) => {
			if (path !== '/capabilities/resolve') throw new Error(`Unexpected POST ${path}`);
			const accountId = request.body?.account_ids?.[0];
			return Promise.resolve(
				response({
					accounts: [
						{ account_id: accountId, settings: accountId === 'bot' ? [discordChannelSetting] : [] }
					]
				})
			) as never;
		});
		putMock.mockImplementation(() => new Promise(() => {}) as never);
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [
				{ id: 'webhook', platform: 'discord', account_username: 'fixed' },
				{ id: 'bot', platform: 'discord', account_username: 'bot' }
			] as never,
			capabilities: [
				{
					provider: 'discord',
					output_profile: 'discord.message',
					label: 'Message',
					settings: [discordChannelSetting]
				}
			] as never,
			selectedSetId: existing.id,
			onApply: vi.fn()
		});
		await openManager(screen);
		await screen.getByRole('button', { name: 'Edit post settings' }).nth(0).click();
		await expect
			.element(screen.getByText('This account has no reusable post settings.'))
			.toBeVisible();
		const settingsDialog = screen.getByRole('dialog', { name: 'Discord settings' });
		await expect.element(settingsDialog).not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Edit post settings' }).nth(1).click();
		await expect.element(settingsDialog.getByRole('combobox', { name: 'Channel' })).toBeVisible();
		await settingsDialog.getByRole('button', { name: 'Done' }).click();
		await screen
			.getByRole('dialog', { name: 'Manage Social Sets' })
			.getByRole('button', { name: 'Save' })
			.click();
		expect(putMock).toHaveBeenCalledWith('/social-sets/{id}', {
			params: { path: { id: existing.id } },
			body: {
				name: existing.name,
				is_default: false,
				accounts: [
					{
						social_account_id: 'webhook',
						default_output_profile: undefined,
						default_settings: {},
						default_segment_settings: {}
					},
					{
						social_account_id: 'bot',
						default_output_profile: undefined,
						default_settings: {},
						default_segment_settings: {}
					}
				]
			}
		});
	});

	it('does not refresh or apply an old Social Set save in a new Workspace', async () => {
		const save = deferred<{ data: SocialSet; error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		postMock.mockReturnValue(save.promise as never);
		installResolvedReads();
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), []);
		const onApply = vi.fn();
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [],
			onApply
		});
		await openManager(screen);
		await screen.getByRole('textbox', { name: 'Set name' }).fill('Workspace A set');
		await screen.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
		expect(postMock).toHaveBeenCalledWith('/social-sets', {
			body: {
				workspace_id: 'workspace-a',
				name: 'Workspace A set',
				is_default: true,
				accounts: []
			}
		});

		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-b'), [
			socialSet('workspace-b')
		]);
		await screen.rerender({ workspaceId: 'workspace-b', accounts: [], onApply });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const workspaceBReads = socialSetReadCount('workspace-b');

		save.resolve({
			data: socialSet('workspace-a'),
			error: undefined,
			response: new Response(null, { status: 201 })
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(socialSetReadCount('workspace-b')).toBe(workspaceBReads);
		expect(onApply).not.toHaveBeenCalled();
	});

	function installResolvedReads() {
		getMock.mockImplementation(
			(path, request: { params?: { query?: { workspace_id?: string } } }) => {
				if (path !== '/social-sets') throw new Error(`Unexpected GET ${path}`);
				const workspaceID = request?.params?.query?.workspace_id ?? '';
				readWorkspaces.push(workspaceID);
				// SAFETY: The fixture contains every response field consumed by the component.
				return Promise.resolve(response([socialSet(workspaceID)])) as never;
			}
		);
	}

	async function openManager(screen: Awaited<ReturnType<typeof render>>) {
		await screen.getByTestId('composer-account-control').click();
		await screen.getByRole('button', { name: 'Manage Social Sets' }).click();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
	}

	function socialSetReadCount(workspaceID: string) {
		return readWorkspaces.filter((readWorkspace) => readWorkspace === workspaceID).length;
	}
});

function socialSet(workspaceID: string): SocialSet {
	return {
		id: `${workspaceID}-set`,
		workspace_id: workspaceID,
		name: `${workspaceID} set`,
		is_default: false,
		accounts: [],
		created_at: '2026-09-01T10:00:00Z',
		updated_at: '2026-09-01T10:00:00Z'
	};
}

const xReplySetting = {
	key: 'reply_settings',
	label: 'Who can reply',
	message_key: '',
	group: 'conversation',
	control: 'select',
	type: 'select',
	scope: 'destination',
	required: false,
	options: ['following', 'mentionedUsers']
};

const discordChannelSetting = {
	key: 'channel_id',
	label: 'Channel',
	message_key: '',
	group: 'distribution',
	control: 'remote_picker',
	type: 'select',
	scope: 'destination',
	required: true,
	options_source: 'discord_channels'
};

function response<T>(data: T) {
	return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}
