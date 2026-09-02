import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import OrganizationOwnershipSettings from './organization-ownership-settings.svelte';

const mocks = { get: vi.fn() };
vi.spyOn(client, 'GET').mockImplementation(mocks.get);

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function team(ownerID: string, ownerEmail: string) {
	return {
		data: {
			members: [{ user_id: ownerID, email: ownerEmail, role: 'owner' }]
		}
	};
}

describe('OrganizationOwnershipSettings', () => {
	beforeEach(() => mocks.get.mockReset());

	it('reselects a changed URL Organization and discards the previous late response', async () => {
		const alphaTeam = deferred<ReturnType<typeof team>>();
		mocks.get.mockImplementation(
			(path: string, request?: { params?: { path?: { id?: string } } }) => {
				if (path === undefined) return Promise.resolve({ data: [] });
				if (path === '/organizations') {
					return Promise.resolve({
						data: [
							{ id: 'org-alpha', name: 'Alpha', role: 'owner' },
							{ id: 'org-beta', name: 'Beta', role: 'owner' }
						]
					});
				}
				if (path === '/organizations/{id}/team') {
					return request?.params?.path?.id === 'org-alpha'
						? alphaTeam.promise
						: Promise.resolve(team('beta-owner', 'beta-owner@example.com'));
				}
				if (path === '/organizations/{id}/ownership-transfer') {
					return Promise.resolve({ data: { pending: false }, response: { status: 200 } });
				}
				if (path === '/auth/security') {
					return Promise.resolve({ data: { user: { password_usable: true }, passkeys: [] } });
				}
				if (path === '/auth/oidc/identities') return Promise.resolve({ data: [] });
				throw new Error(`Unexpected GET ${path}`);
			}
		);

		const screen = await render(OrganizationOwnershipSettings, {
			preferredOrganizationID: 'org-alpha',
			currentUserID: 'beta-owner',
			active: true
		});
		await vi.waitFor(() =>
			expect(mocks.get).toHaveBeenCalledWith('/organizations/{id}/team', {
				params: { path: { id: 'org-alpha' } },
				signal: expect.any(AbortSignal)
			})
		);

		await screen.rerender({
			preferredOrganizationID: 'org-beta',
			currentUserID: 'beta-owner',
			active: true
		});
		await expect.element(screen.getByText(/beta-owner@example.com/)).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Delete Organization' })).toBeVisible();
		expect(mocks.get).toHaveBeenCalledWith('/organizations/{id}/team', {
			params: { path: { id: 'org-beta' } },
			signal: expect.any(AbortSignal)
		});

		alphaTeam.resolve(team('alpha-owner', 'alpha-owner@example.com'));
		await vi.waitFor(() => expect(screen.getByText(/alpha-owner@example.com/).query()).toBeNull());
		await expect.element(screen.getByText(/beta-owner@example.com/)).toBeVisible();
		expect(mocks.get.mock.calls.filter(([path]) => path === undefined)).toEqual([]);
	});
});
