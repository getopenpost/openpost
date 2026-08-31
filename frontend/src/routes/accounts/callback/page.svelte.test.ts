import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import CallbackPage from './accounts-callback-page.svelte';

const mocks = {
	goto: vi.fn(),
	get: vi.fn(),
	post: vi.fn()
};
vi.spyOn(client, 'GET').mockImplementation(mocks.get);
vi.spyOn(client, 'POST').mockImplementation(mocks.post);

const pendingSelection = {
	id: 'conn_123',
	platform: 'facebook',
	workspace_id: 'workspace_123',
	expires_at: '2026-07-13T18:00:00Z',
	options: [
		{
			id: 'page_1',
			display_name: 'OpenPost Page',
			username: 'openpost',
			kind: 'page',
			description: 'Main brand page',
			avatar_url: 'https://example.com/avatar.jpg',
			extra: { followers: '1,240' }
		},
		{
			id: 'account_2',
			display_name: 'Personal Profile',
			username: 'person'
		}
	]
};

function setCallbackUrl(query: string) {
	History.prototype.pushState.call(window.history, {}, '', `/accounts/callback?${query}`);
}

function renderCallbackPage() {
	return render(CallbackPage, { navigate: mocks.goto });
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe('account OAuth callback selection flow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.get.mockResolvedValue({ data: pendingSelection, error: null });
		mocks.post.mockResolvedValue({
			data: {
				id: 'saved_account',
				workspace_id: 'workspace_123',
				account_ids: ['saved_account'],
				open_fresh_composer: true
			},
			error: null
		});
	});

	it('does not claim success or redirect while account selection is required', async () => {
		setCallbackUrl('status=selection_required&platform=facebook&connection_id=conn_123');

		const screen = await renderCallbackPage();

		await expect
			.element(
				screen.getByRole('heading', {
					level: 1,
					name: 'Choose Facebook account'
				})
			)
			.toBeVisible();
		await expect.element(screen.getByText('OpenPost Page')).toBeVisible();
		expect(screen.container.textContent).toMatch(/Facebook\s*·\s*openpost\s*·\s*page/);
		await expect.element(screen.getByText('followers: 1,240')).toBeVisible();
		await expect
			.element(screen.getByText(/This deadline only applies to this selection step/))
			.toBeVisible();
		expect(screen.container.textContent).not.toContain('Account connected');
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(mocks.get).toHaveBeenCalledWith('/accounts/selections/{connection_id}', {
			params: { path: { connection_id: 'conn_123' } }
		});
	});

	it('posts the chosen selection and only then transitions to success', async () => {
		const post = deferred<{
			data: {
				id: string;
				workspace_id: string;
				account_ids: string[];
				open_fresh_composer: boolean;
			};
			error: null;
		}>();
		mocks.post.mockReturnValue(post.promise);
		setCallbackUrl('status=selection_required&platform=facebook&connection_id=conn_123');

		const screen = await renderCallbackPage();

		await screen.getByRole('radio', { name: /OpenPost Page/ }).click();
		await screen.getByRole('button', { name: 'Connect selected account' }).click();

		expect(mocks.post).toHaveBeenCalledWith('/accounts/selections/{connection_id}/complete', {
			params: { path: { connection_id: 'conn_123' } },
			body: { selection_id: 'page_1' }
		});
		expect(screen.container.textContent).not.toContain('Account connected');
		expect(screen.container.textContent).not.toContain('Redirecting you back to Settings');

		post.resolve({
			data: {
				id: 'saved_account',
				workspace_id: 'workspace_123',
				account_ids: ['saved_account'],
				open_fresh_composer: true
			},
			error: null
		});
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith(
				'/?workspace_id=workspace_123&account_ids=saved_account'
			)
		);
		expect(screen.container.textContent).not.toContain('Account connected');
		expect(screen.container.textContent).not.toContain('Create first post');
	});

	it('opens a fresh composer with every selected LinkedIn destination', async () => {
		mocks.get.mockResolvedValue({
			data: {
				...pendingSelection,
				platform: 'linkedin',
				options: [
					{
						id: 'person:member-1',
						display_name: 'Ada Member',
						kind: 'Personal profile'
					},
					{
						id: 'organization:42',
						display_name: 'OpenPost',
						kind: 'Organization Page'
					}
				]
			},
			error: null
		});
		mocks.post.mockResolvedValue({
			data: {
				id: 'account-1',
				workspace_id: 'workspace_123',
				account_ids: ['account-1', 'account-2'],
				open_fresh_composer: true
			},
			error: null
		});
		setCallbackUrl('status=selection_required&platform=linkedin&connection_id=conn_123');

		const screen = await renderCallbackPage();
		await screen.getByRole('checkbox', { name: /Ada Member/ }).click();
		await screen.getByRole('checkbox', { name: /OpenPost/ }).click();
		await screen.getByRole('button', { name: 'Connect selected (2)' }).click();

		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith(
				'/?workspace_id=workspace_123&account_ids=account-1%2Caccount-2'
			)
		);
	});

	it('returns re-authorization to Settings instead of opening the first-use composer', async () => {
		mocks.post.mockResolvedValue({
			data: {
				id: 'saved_account',
				workspace_id: 'workspace_123',
				account_ids: ['saved_account'],
				open_fresh_composer: false
			},
			error: null
		});
		setCallbackUrl('status=selection_required&platform=facebook&connection_id=conn_123');

		const screen = await renderCallbackPage();
		await screen.getByRole('radio', { name: /OpenPost Page/ }).click();
		await screen.getByRole('button', { name: 'Connect selected account' }).click();

		await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/settings?tab=accounts'));
		expect(screen.container.textContent).not.toContain('Account connected');
	});

	it('connects several LinkedIn identities from one grant', async () => {
		mocks.get.mockResolvedValue({
			data: {
				...pendingSelection,
				platform: 'linkedin',
				options: [
					{
						id: 'person:member-1',
						display_name: 'Ada Member',
						kind: 'Personal profile'
					},
					{
						id: 'organization:42',
						display_name: 'OpenPost',
						kind: 'Organization Page'
					}
				]
			},
			error: null
		});
		setCallbackUrl('status=selection_required&platform=linkedin&connection_id=conn_123');

		const screen = await renderCallbackPage();
		await screen.getByRole('checkbox', { name: /Ada Member/ }).click();
		await screen.getByRole('checkbox', { name: /OpenPost/ }).click();
		await screen.getByRole('button', { name: 'Connect selected (2)' }).click();

		expect(mocks.post).toHaveBeenCalledWith('/accounts/selections/{connection_id}/complete', {
			params: { path: { connection_id: 'conn_123' } },
			body: { selection_ids: ['person:member-1', 'organization:42'] }
		});
	});

	it('surfaces rejected account-selection loads', async () => {
		mocks.get.mockRejectedValue(new Error('Network unavailable.'));
		setCallbackUrl('status=selection_required&platform=facebook&connection_id=conn_123');

		const screen = await renderCallbackPage();

		await expect
			.element(screen.getByText('This account selection could not be loaded. Network unavailable.'))
			.toBeVisible();
		expect(screen.container.textContent).not.toContain('Loading account choices');
	});

	it('surfaces account-selection API errors', async () => {
		mocks.post.mockResolvedValue({
			data: null,
			error: {
				type: 'about:blank',
				title: 'Selection failed',
				detail: 'That page is no longer available.'
			}
		});
		setCallbackUrl('status=selection_required&platform=instagram&connection_id=conn_123');

		const screen = await renderCallbackPage();

		await screen.getByRole('radio', { name: /OpenPost Page/ }).click();
		await screen.getByRole('button', { name: 'Connect selected account' }).click();

		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith(
				'/settings?tab=accounts&oauth_status=failed&workspace_id=workspace_123'
			)
		);
	});

	it('returns rejected account-selection completion to scoped account management', async () => {
		mocks.post.mockRejectedValueOnce(new Error('Connection interrupted.'));
		setCallbackUrl('status=selection_required&platform=instagram&connection_id=conn_123');

		const screen = await renderCallbackPage();

		await screen.getByRole('radio', { name: /OpenPost Page/ }).click();
		await screen.getByRole('button', { name: 'Connect selected account' }).click();

		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith(
				'/settings?tab=accounts&oauth_status=failed&workspace_id=workspace_123'
			)
		);
	});
});
