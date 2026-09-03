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
const deleteMock = vi.spyOn(client, 'DELETE');

describe('Social Set request ownership', () => {
	beforeEach(() => {
		queryClient.clear();
		getMock.mockReset();
		postMock.mockReset();
		deleteMock.mockReset();
	});

	it('does not project an old Social Set read into a new Workspace', async () => {
		const workspaceARead = deferred<ReturnType<typeof response<SocialSet[]>>>();
		getMock.mockImplementation((path, request) => {
			if (path !== '/social-sets') throw new Error(`Unexpected GET ${path}`);
			const workspaceID = request?.params?.query?.workspace_id ?? '';
			// SAFETY: Both branches match the endpoint response used by this test.
			return (
				workspaceID === 'workspace-a'
					? workspaceARead.promise
					: Promise.resolve(response([socialSet('workspace-b')]))
			) as never;
		});
		const onApply = vi.fn();
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [],
			onApply
		});
		await vi.waitFor(() => expect(socialSetReadCount('workspace-a')).toBe(1));

		await screen.rerender({
			workspaceId: 'workspace-b',
			accounts: [],
			onApply
		});
		await screen.getByTestId('composer-account-control').click();
		await expect.element(screen.getByText('workspace-b set')).toBeVisible();

		workspaceARead.resolve(response([socialSet('workspace-a')]));
		await new Promise((resolve) => setTimeout(resolve, 20));

		await expect.element(screen.getByText('workspace-b set')).toBeVisible();
		await expect.element(screen.getByText('workspace-a set')).not.toBeInTheDocument();
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

	it('does not refresh or apply an old Social Set deletion in a new Workspace', async () => {
		const deletion = deferred<{ error: undefined; response: Response }>();
		// SAFETY: The deferred value matches the endpoint response used by this test.
		deleteMock.mockReturnValue(deletion.promise as never);
		installResolvedReads();
		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-a'), [
			socialSet('workspace-a')
		]);
		const onApply = vi.fn();
		const screen = await render(SocialSetControl, {
			workspaceId: 'workspace-a',
			accounts: [],
			selectedSetId: 'workspace-a-set',
			onApply
		});
		await openManager(screen);
		await screen.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
		const dialogs = screen.getByRole('dialog');
		await dialogs.nth(1).getByRole('button', { name: 'Delete' }).click();
		expect(deleteMock).toHaveBeenCalledWith('/social-sets/{id}', {
			params: { path: { id: 'workspace-a-set' }, query: { confirm: true } }
		});

		queryClient.setQueryData(openPostQueryKeys.socialSets('workspace-b'), [
			socialSet('workspace-b')
		]);
		await screen.rerender({
			workspaceId: 'workspace-b',
			accounts: [],
			selectedSetId: 'workspace-b-set',
			onApply
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		const workspaceBReads = socialSetReadCount('workspace-b');

		deletion.resolve({ error: undefined, response: new Response(null, { status: 204 }) });
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(socialSetReadCount('workspace-b')).toBe(workspaceBReads);
		expect(onApply).not.toHaveBeenCalled();
	});

	function installResolvedReads() {
		getMock.mockImplementation((path, request) => {
			if (path !== '/social-sets') throw new Error(`Unexpected GET ${path}`);
			const workspaceID = request?.params?.query?.workspace_id ?? '';
			// SAFETY: The fixture contains every response field consumed by the component.
			return Promise.resolve(response([socialSet(workspaceID)])) as never;
		});
	}

	async function openManager(screen: Awaited<ReturnType<typeof render>>) {
		await screen.getByTestId('composer-account-control').click();
		await screen.getByRole('button', { name: 'Manage Social Sets' }).click();
		await expect.element(screen.getByRole('dialog')).toBeVisible();
	}

	function socialSetReadCount(workspaceID: string) {
		return getMock.mock.calls.filter(
			([path, request]) =>
				path === '/social-sets' && request?.params?.query?.workspace_id === workspaceID
		).length;
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
