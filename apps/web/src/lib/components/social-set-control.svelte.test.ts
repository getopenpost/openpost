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
		putMock.mockImplementation(() => new Promise(() => {}) as never);
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [{ id: 'acc-1', platform: 'x', account_username: 'openpost' }] as never,
			capabilities: [
				{
					provider: 'x',
					output_profile: 'x.post',
					label: 'Post',
					settings: [
						{
							key: 'reply_settings',
							label: 'Who can reply',
							message_key: '',
							group: 'conversation',
							control: 'select',
							type: 'select',
							scope: 'destination',
							required: false,
							options: ['following', 'mentionedUsers']
						}
					]
				}
			] as never,
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
