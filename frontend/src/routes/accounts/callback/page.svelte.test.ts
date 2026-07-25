import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CallbackPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	get: vi.fn(),
	post: vi.fn()
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto
}));

vi.mock('$lib/api/client', () => ({
	client: {
		GET: mocks.get,
		POST: mocks.post
	}
}));

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
		mocks.post.mockResolvedValue({ data: { id: 'saved_account' }, error: null });
	});

	it('does not claim success or redirect while account selection is required', async () => {
		setCallbackUrl('status=selection_required&platform=facebook&connection_id=conn_123');

		const screen = await render(CallbackPage);

		await expect
			.element(screen.getByRole('heading', { level: 1, name: 'Choose Facebook account' }))
			.toBeVisible();
		await expect.element(screen.getByText('OpenPost Page')).toBeVisible();
		await expect.element(screen.getByText('@openpost · page')).toBeVisible();
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
		const post = deferred<{ data: { id: string }; error: null }>();
		mocks.post.mockReturnValue(post.promise);
		setCallbackUrl('status=selection_required&platform=facebook&connection_id=conn_123');

		const screen = await render(CallbackPage);

		await screen.getByRole('radio', { name: /OpenPost Page/ }).click();
		await screen.getByRole('button', { name: 'Connect selected account' }).click();

		expect(mocks.post).toHaveBeenCalledWith('/accounts/selections/{connection_id}/complete', {
			params: { path: { connection_id: 'conn_123' } },
			body: { selection_id: 'page_1' }
		});
		expect(screen.container.textContent).not.toContain('Account connected');
		expect(screen.container.textContent).not.toContain('Redirecting you back to accounts');

		post.resolve({ data: { id: 'saved_account' }, error: null });
		await expect
			.element(screen.getByRole('heading', { level: 1, name: 'Account connected' }))
			.toBeVisible();
	});

	it('surfaces rejected account-selection loads', async () => {
		mocks.get.mockRejectedValue(new Error('Network unavailable.'));
		setCallbackUrl('status=selection_required&platform=facebook&connection_id=conn_123');

		const screen = await render(CallbackPage);

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

		const screen = await render(CallbackPage);

		await screen.getByRole('radio', { name: /OpenPost Page/ }).click();
		await screen.getByRole('button', { name: 'Connect selected account' }).click();

		await expect.element(screen.getByText('That page is no longer available.')).toBeVisible();
		expect(screen.container.textContent).not.toContain('Redirecting you back to accounts');
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('surfaces rejected account-selection completion and allows retrying', async () => {
		mocks.post.mockRejectedValueOnce(new Error('Connection interrupted.'));
		setCallbackUrl('status=selection_required&platform=instagram&connection_id=conn_123');

		const screen = await render(CallbackPage);

		await screen.getByRole('radio', { name: /OpenPost Page/ }).click();
		await screen.getByRole('button', { name: 'Connect selected account' }).click();

		await expect
			.element(
				screen.getByText('OpenPost could not save that account selection. Connection interrupted.')
			)
			.toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Connect selected account' }))
			.toBeEnabled();
		expect(screen.container.textContent).not.toContain('Account connected');
	});
});
