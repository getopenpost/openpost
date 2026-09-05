import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { themeQueryKeys } from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import { getBuiltInTheme } from '$lib/themes';
import { builtInManifestReference } from './theme-library-model';
import ThemeAppearanceSettings from './theme-appearance-settings.svelte';
import '../../../routes/layout.css';

const testPage = vi.hoisted(() => ({ url: new URL('http://localhost/settings') }));
// Standalone component tests have no SvelteKit router; provide its public URL state.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/state', () => ({ page: testPage }));
const postMock = vi.spyOn(client, 'POST');
const getMock = vi.spyOn(client, 'GET');
const putMock = vi.spyOn(client, 'PUT');
const manifest = getBuiltInTheme('workshop');
const reference = builtInManifestReference(manifest.id, manifest.revision);
const settings = {
	can_manage_organization: true,
	can_manage_workspace: true,
	organization_default: reference,
	effective_selection: reference,
	assignments_locked: false
};
const workspace = {
	id: 'workspace-a',
	name: 'Workspace',
	avatar_url: '',
	color: '',
	can_edit: true,
	role: 'admin',
	created_at: '',
	organization_id: 'org-a',
	organization_name: 'Organization',
	sso_authenticated: true,
	sso_identity_linked: true,
	sso_required: false
};

beforeEach(() => {
	queryClient.clear();
	testPage.url = new URL('http://localhost/settings');
	postMock.mockReset();
	workspaceCtx.currentWorkspace = workspace;
	workspaceCtx.workspaces = [workspace, { ...workspace, id: 'workspace-b' }];
	getMock.mockReset();
	putMock.mockReset();
	getMock.mockImplementation(
		async (path) =>
			// SAFETY: These fixtures supply the settings, theme detail, and empty list shapes read by this component.
			({
				data: path === '/theme-settings' ? settings : { items: [], next_cursor: null },
				response: new Response()
			}) as never
	);
	// SAFETY: This write fixture is used only by organization theme settings.
	putMock.mockResolvedValue({ data: settings, response: new Response() } as never);
});

it('loads the available catalog once for both selection and previews', async () => {
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByRole('button', { name: 'Test Notebook' })).toBeEnabled();
	expect(getMock.mock.calls.filter(([path]) => path === '/themes/available')).toHaveLength(1);
});

it('invalidates sibling workspace settings when locking organization theme assignments', async () => {
	const sibling = themeQueryKeys.settings('workspace-b');
	queryClient.setQueryData(sibling, settings);
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect
		.element(screen.getByRole('switch', { name: 'Lock workspace theme selection' }))
		.toBeEnabled();
	await screen.getByRole('switch', { name: 'Lock workspace theme selection' }).click();
	await screen.getByRole('button', { name: 'Lock and clear choices' }).click();
	await vi.waitFor(() => expect(queryClient.getQueryState(sibling)?.isInvalidated).toBe(true));
});

it('retries publishing with the saved draft revision after publishing fails', async () => {
	testPage.url = new URL('http://localhost/settings?tab=appearance&theme=custom-theme');
	let revision = 1;
	const draft = () => ({
		summary: {
			reference: { kind: 'custom', id: 'custom-theme', version: 1 },
			name: 'Custom theme'
		},
		draft: { revision, manifest }
	});
	getMock.mockImplementation(
		async (path) =>
			// SAFETY: These fixtures supply the settings, theme detail, and empty list shapes read by this component.
			({
				data:
					path === '/theme-settings'
						? settings
						: path === '/themes/{id}'
							? draft()
							: { items: [], next_cursor: null },
				response: new Response()
			}) as never
	);
	putMock.mockImplementation(async () => {
		revision += 1;
		// SAFETY: The draft endpoint returns the newly saved theme detail.
		return { data: draft(), response: new Response() } as never;
	});
	// SAFETY: Publish exercises the API error response without success data.
	postMock.mockResolvedValue({
		error: { detail: 'Publishing unavailable' },
		response: new Response(null, { status: 503 })
	} as never);
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
	await expect.element(screen.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
	await screen.getByRole('button', { name: 'Publish', exact: true }).click();
	await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
	await expect.element(screen.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
	await screen.getByRole('button', { name: 'Publish', exact: true }).click();
	await vi.waitFor(() => expect(putMock).toHaveBeenCalledTimes(2));
	expect(putMock.mock.calls.map(([, options]) => options?.body?.expected_revision)).toEqual([1, 2]);
});
