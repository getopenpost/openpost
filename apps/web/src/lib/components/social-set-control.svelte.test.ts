import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import { client, type SocialAccount } from '$lib/api/client';
import { openPostQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import SocialSetControl from './social-set-control.svelte';

type SocialSet = components['schemas']['SocialSetResponse'];
type Capability = components['schemas']['Capability'];
type SettingDefinition = components['schemas']['SettingDefinition'];
type ResolvedSettings = components['schemas']['ResolveSocialSetSettingsOutputBody'];

const getMock = vi.fn();
const postMock = vi.fn();
const putMock = vi.fn();
vi.spyOn(client, 'GET').mockImplementation(getMock);
vi.spyOn(client, 'POST').mockImplementation(postMock);
vi.spyOn(client, 'PUT').mockImplementation(putMock);
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
		postMock.mockImplementation((path: string) => {
			if (path !== '/social-sets/resolve-settings') throw new Error(`Unexpected POST ${path}`);
			return Promise.resolve(
				response({
					account_id: 'acc-1',
					output_profile: 'x.post',
					settings: [xReplySetting]
				} satisfies ResolvedSettings)
			);
		});
		putMock.mockImplementation(() => new Promise(() => {}));
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [socialAccount('acc-1', 'x', 'openpost')],
			capabilities: [capability('x', 'x.post', 'Post'), capability('x', 'x.video', 'Video')],
			selectedSetId: existing.id,
			onApply: vi.fn()
		});
		await openManager(screen);
		await screen.getByRole('button', { name: /Format for/ }).click();
		await screen.getByRole('option', { name: 'Video', exact: true }).click();
		await screen.getByRole('button', { name: /Format for/ }).click();
		await screen.getByRole('option', { name: 'Post', exact: true }).click();
		await screen.getByRole('button', { name: 'Edit post settings' }).click();
		expect(postMock).toHaveBeenCalledWith('/social-sets/resolve-settings', {
			body: {
				social_account_id: 'acc-1',
				default_output_profile: 'x.post',
				settings: { reply_settings: 'following' },
				locale: expect.any(String),
				region: expect.any(String)
			}
		});
		const settingsDialog = screen.getByRole('dialog', { name: 'X settings' });
		await expect.element(settingsDialog).toBeVisible();
		await settingsDialog.getByRole('button', { name: /^(following|Who can reply)$/ }).click();
		await screen.getByRole('option', { name: 'Mentioned users', exact: true }).click();
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
				locale: expect.any(String),
				region: expect.any(String),
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

	it('preserves an API-authored embed when its Social Set is opened and renamed', async () => {
		const existing = socialSet('workspace-a');
		const embed = { title: 'Launch', fields: [{ name: 'Version', value: '4.30' }] };
		existing.accounts = [
			{
				social_account_id: 'bot',
				platform: 'discord',
				display_order: 0,
				default_output_profile: 'discord.post',
				default_settings: { embed },
				default_segment_settings: {}
			}
		];
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), [existing]);
		installResolvedReads();
		postMock.mockResolvedValue(
			response({
				account_id: 'bot',
				output_profile: 'discord.post',
				settings: [
					{
						key: 'embed',
						label: 'Embed',
						message_key: '',
						type: 'json',
						control: 'structured_editor',
						group: 'content',
						scope: 'destination',
						required: false
					}
				]
			} satisfies ResolvedSettings)
		);
		putMock.mockImplementation(() => new Promise(() => {}));
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [socialAccount('bot', 'discord', 'Test server')],
			capabilities: [capability('discord', 'discord.post', 'Discord message')],
			selectedSetId: existing.id,
			onApply: vi.fn()
		});
		await openManager(screen);
		await screen.getByRole('button', { name: 'Edit post settings' }).click();
		const settings = screen.getByRole('dialog', { name: 'Discord settings' });
		await expect
			.element(settings.getByRole('textbox', { name: 'Title', exact: true }))
			.toHaveValue('Launch');
		await settings.getByRole('button', { name: 'Done' }).click();
		const manager = screen.getByRole('dialog', { name: 'Manage Social Sets' });
		await manager.getByRole('textbox', { name: 'Set name' }).fill('Renamed launches');
		await manager.getByRole('button', { name: 'Save', exact: true }).click();
		expect(putMock).toHaveBeenCalledWith(
			'/social-sets/{id}',
			expect.objectContaining({
				body: expect.objectContaining({
					name: 'Renamed launches',
					accounts: [
						{
							social_account_id: 'bot',
							default_output_profile: 'discord.post',
							default_settings: { embed },
							default_segment_settings: {}
						}
					]
				})
			})
		);
	});

	it('uses account-resolved fields for bot and webhook Social Set presets', async () => {
		const existing = socialSet('workspace-a');
		existing.accounts = [
			{
				social_account_id: 'webhook',
				platform: 'discord',
				display_order: 0,
				default_output_profile: 'discord.post',
				default_settings: { channel_id: 'stale' }
			},
			{
				social_account_id: 'bot',
				platform: 'discord',
				display_order: 1,
				default_output_profile: 'discord.post'
			}
		];
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), [existing]);
		installResolvedReads();
		postMock.mockImplementation(
			(path: string, request: { body?: { social_account_id?: string } }) => {
				if (path !== '/social-sets/resolve-settings') throw new Error(`Unexpected POST ${path}`);
				const accountId = request.body?.social_account_id;
				if (!accountId) throw new Error('Expected an account-specific preset request');
				return Promise.resolve(
					response({
						account_id: accountId,
						output_profile: 'discord.post',
						settings: accountId === 'bot' ? [discordChannelSetting] : []
					} satisfies ResolvedSettings)
				);
			}
		);
		putMock.mockImplementation(() => new Promise(() => {}));
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [
				socialAccount('webhook', 'discord', 'fixed'),
				socialAccount('bot', 'discord', 'bot')
			],
			capabilities: [
				{
					...capability('discord', 'discord.post', 'Discord message'),
					settings: [discordChannelSetting]
				},
				capability('discord', 'discord.post', 'Discord attachment')
			],
			selectedSetId: existing.id,
			onApply: vi.fn()
		});
		await openManager(screen);
		await screen
			.getByRole('button', { name: /Format for/ })
			.first()
			.click();
		await expect
			.element(screen.getByRole('option', { name: 'Discord message', exact: true }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('option', { name: 'Discord attachment', exact: true }))
			.not.toBeInTheDocument();
		await screen.getByRole('option', { name: 'Discord message', exact: true }).click();
		await screen.getByRole('button', { name: 'Edit post settings' }).nth(0).click();
		await expect
			.element(screen.getByText('This account has no reusable post settings.'))
			.toBeVisible();
		const settingsDialog = screen.getByRole('dialog', {
			name: 'Discord settings'
		});
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
				locale: expect.any(String),
				region: expect.any(String),
				accounts: [
					{
						social_account_id: 'webhook',
						default_output_profile: 'discord.post',
						default_settings: {},
						default_segment_settings: {}
					},
					{
						social_account_id: 'bot',
						default_output_profile: 'discord.post',
						default_settings: {},
						default_segment_settings: {}
					}
				]
			}
		});
	});

	it('keeps video presets visible and removes values outside the selected format', async () => {
		const existing = socialSet('workspace-a');
		existing.accounts = [
			{
				social_account_id: 'tiktok-1',
				platform: 'tiktok',
				display_order: 0,
				default_output_profile: 'tiktok.video',
				default_settings: {
					content_posting_method: 'DIRECT_POST',
					is_aigc: true,
					photo_title: 'Old photo title'
				}
			}
		];
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), [existing]);
		installResolvedReads();
		postMock.mockImplementation((path: string) => {
			if (path !== '/social-sets/resolve-settings') throw new Error(`Unexpected POST ${path}`);
			return Promise.resolve(
				response({
					account_id: 'tiktok-1',
					output_profile: 'tiktok.video',
					settings: [tiktokPostingMethodSetting, tiktokAIGCSetting]
				} satisfies ResolvedSettings)
			);
		});
		putMock.mockImplementation(() => new Promise(() => {}));
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [socialAccount('tiktok-1', 'tiktok', 'creator')],
			capabilities: [capability('tiktok', 'tiktok.video', 'TikTok video')],
			selectedSetId: existing.id,
			onApply: vi.fn()
		});
		await openManager(screen);
		await screen.getByRole('button', { name: 'Edit post settings' }).click();
		const dialog = screen.getByRole('dialog', { name: 'TikTok settings' });
		await expect.element(dialog.getByText('AI-generated content')).toBeVisible();
		await expect.element(dialog.getByText('Photo post title')).not.toBeInTheDocument();
		await dialog.getByRole('button', { name: 'Done' }).click();
		await screen
			.getByRole('dialog', { name: 'Manage Social Sets' })
			.getByRole('button', { name: 'Save' })
			.click();
		expect(putMock).toHaveBeenCalledWith(
			'/social-sets/{id}',
			expect.objectContaining({
				body: expect.objectContaining({
					accounts: [
						expect.objectContaining({
							default_output_profile: 'tiktok.video',
							default_settings: {
								content_posting_method: 'DIRECT_POST',
								is_aigc: true
							}
						})
					]
				})
			})
		);
	});

	it('keeps Automatic free of format-specific presets', async () => {
		const existing = socialSet('workspace-a');
		existing.accounts = [{ social_account_id: 'acc-1', platform: 'x', display_order: 0 }];
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), [existing]);
		installResolvedReads();
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [socialAccount('acc-1', 'x', 'openpost')],
			capabilities: [capability('x', 'x.post', 'Post')],
			selectedSetId: existing.id,
			onApply: vi.fn()
		});
		await openManager(screen);
		await expect.element(screen.getByRole('button', { name: 'Edit post settings' })).toBeDisabled();
		await expect.element(screen.getByText('Choose a format')).toBeVisible();
		await screen.getByRole('button', { name: /Format for/ }).click();
		await expect.element(screen.getByRole('option', { name: 'Post', exact: true })).toBeVisible();
		await screen.getByRole('option', { name: 'Post', exact: true }).click();
		await expect.element(screen.getByRole('button', { name: 'Edit post settings' })).toBeEnabled();
		expect(postMock).not.toHaveBeenCalled();
	});

	it('does not refresh or apply an old Social Set save in a new Workspace', async () => {
		const save = deferred<{
			data: SocialSet;
			error: undefined;
			response: Response;
		}>();
		postMock.mockReturnValue(save.promise);
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
				locale: expect.any(String),
				region: expect.any(String),
				accounts: []
			}
		});

		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-b'), [
			socialSet('workspace-b')
		]);
		await screen.rerender({
			workspaceId: 'workspace-b',
			accounts: [],
			onApply
		});
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
				return Promise.resolve(response([socialSet(workspaceID)]));
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

function socialAccount(id: string, platform: string, account_username: string): SocialAccount {
	return {
		id,
		slug: id,
		platform,
		account_id: id,
		account_username,
		account_avatar_url: '',
		instance_url: '',
		is_active: true,
		thread_replies_supported: true,
		messaging_supported: false,
		messages_enabled: false,
		grant_destination_count: 1,
		shared_grant: false
	};
}

function capability(provider: string, output_profile: string, label: string): Capability {
	const text = { required: false };
	return {
		provider,
		output_profile,
		label,
		profile: output_profile,
		capability_revision: 'test-revision',
		content: { alt_text: text, body: text, description: text, title: text },
		media: {
			allowed_mimes: [],
			max_count: 0,
			min_count: 0,
			requires_https_fetchable: false,
			requires_public_url: false
		},
		intents: [],
		media_shapes: [],
		native_scheduling: false,
		openpost_queued: true,
		requires_app_review: false,
		requires_public_media: false
	};
}

const xReplySetting: SettingDefinition = {
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

const tiktokPostingMethodSetting: SettingDefinition = {
	key: 'content_posting_method',
	label: 'Posting method',
	message_key: '',
	group: 'distribution',
	control: 'select',
	type: 'select',
	scope: 'destination',
	required: true,
	options: ['DIRECT_POST', 'UPLOAD']
};

const tiktokAIGCSetting: SettingDefinition = {
	key: 'is_aigc',
	label: 'AI-generated content',
	message_key: '',
	group: 'disclosure',
	control: 'toggle',
	type: 'boolean',
	scope: 'destination',
	required: false,
	dependencies: [{ key: 'content_posting_method', operator: 'equals', value: 'DIRECT_POST' }]
};

const discordChannelSetting: SettingDefinition = {
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
	return {
		data,
		error: undefined,
		response: new Response(null, { status: 200 })
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}
