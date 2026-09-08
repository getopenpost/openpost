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

const testPage = vi.hoisted(() => ({
	url: new URL('http://localhost/settings')
}));
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
	putMock.mockResolvedValue({
		data: settings,
		response: new Response()
	} as never);
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
	await screen.getByText('Organization default', { exact: true }).first().click();
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

it('keeps a failed creation open with its name available for retry', async () => {
	// SAFETY: This fixture models the failed create endpoint without success data.
	postMock.mockResolvedValue({
		error: { detail: 'Unavailable' },
		response: new Response(null, { status: 503 })
	} as never);
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await screen.getByRole('button', { name: 'Create theme', exact: true }).click();
	await screen.getByRole('textbox', { name: /Theme name/ }).fill('My theme');
	await screen.getByRole('button', { name: 'Create draft', exact: true }).click();
	await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
	await expect.element(screen.getByRole('dialog')).toBeVisible();
	await expect.element(screen.getByRole('textbox', { name: /Theme name/ })).toHaveValue('My theme');
});

it('keeps theme controls usable during a background catalog refresh', async () => {
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByRole('button', { name: 'Test Notebook' })).toBeEnabled();
	let finish: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		finish = resolve;
	});
	getMock.mockImplementation(async () => {
		await held;
		// SAFETY: This held catalog response supplies the empty theme page used by the component.
		return {
			data: { items: [], next_cursor: null },
			response: new Response()
		} as never;
	});
	const refresh = queryClient.invalidateQueries({
		queryKey: themeQueryKeys.available('workspace-a')
	});
	try {
		await expect.element(screen.getByRole('button', { name: 'Test Notebook' })).toBeEnabled();
		await expect
			.element(screen.getByRole('button', { name: 'Create theme', exact: true }))
			.toBeEnabled();
	} finally {
		finish?.();
		await refresh;
	}
});

it('shows unpublished organization drafts so they can be reopened', async () => {
	const summary = {
		reference: { kind: 'custom', id: 'my-theme', version: 0 },
		name: 'My theme',
		draft_revision: 1,
		published_revision: 0
	};
	getMock.mockImplementation(
		async (path) =>
			// SAFETY: These fixtures supply only the settings, organization list, and draft detail routes exercised here.
			({
				data:
					path === '/theme-settings'
						? settings
						: path === '/themes'
							? { items: [summary], next_cursor: null }
							: path === '/themes/{id}'
								? {
										summary,
										draft: {
											revision: 1,
											manifest: {
												...manifest,
												id: 'my-theme',
												name: 'My theme'
											}
										}
									}
								: { items: [], next_cursor: null },
				response: new Response()
			}) as never
	);
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByText('My theme', { exact: true })).toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
});

it('finishes applying a theme even when the subsequent catalog refresh is slow', async () => {
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect
		.element(screen.getByRole('button', { name: 'Apply Notebook', exact: true }))
		.toBeEnabled();
	let finish: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		finish = resolve;
	});
	getMock.mockImplementation(async () => {
		await held;
		// SAFETY: The held reads return empty theme pages after the assignment assertion.
		return {
			data: { items: [], next_cursor: null },
			response: new Response()
		} as never;
	});
	const notebook = getBuiltInTheme('notebook');
	const choice = builtInManifestReference(notebook.id, notebook.revision);
	// SAFETY: This assignment response supplies the server-confirmed settings and selected theme.
	putMock.mockResolvedValue({
		data: {
			...settings,
			effective_selection: choice,
			workspace_selection: choice
		},
		response: new Response()
	} as never);
	try {
		await screen.getByRole('button', { name: 'Apply Notebook', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Applied Notebook', exact: true }))
			.toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Test Studio', exact: true }))
			.toBeEnabled();
	} finally {
		finish?.();
	}
});

it('loads later organization draft pages without losing the first page', async () => {
	const first = {
		reference: { kind: 'custom', id: 'first-draft', version: 0 },
		name: 'First draft',
		draft_revision: 1,
		published_revision: 0
	};
	const second = {
		...first,
		reference: { ...first.reference, id: 'second-draft' },
		name: 'Second draft'
	};
	getMock.mockImplementation(async (path, options) => {
		const summary = options?.params?.path?.id === second.reference.id ? second : first;
		// SAFETY: The paginated fixtures supply the list and draft detail shapes used by this test.
		return {
			data:
				path === '/theme-settings'
					? settings
					: path === '/themes'
						? options?.params?.query?.cursor
							? { items: [second], next_cursor: null }
							: { items: [first], next_cursor: 'next' }
						: path === '/themes/{id}'
							? {
									summary,
									draft: {
										revision: 1,
										manifest: { ...manifest, id: summary.reference.id, name: summary.name }
									}
								}
							: { items: [], next_cursor: null },
			response: new Response()
		} as never;
	});
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect.element(screen.getByText('First draft', { exact: true })).toBeVisible();
	await screen.getByRole('button', { name: 'Load more', exact: true }).click();
	await expect.element(screen.getByText('Second draft', { exact: true })).toBeVisible();
	await expect.element(screen.getByText('First draft', { exact: true })).toBeVisible();
});

it('offers recovery when theme settings fail to load', async () => {
	// SAFETY: This read fixture returns an API error without success data.
	getMock.mockResolvedValue({
		error: { detail: 'Unavailable' },
		response: new Response(null, { status: 503 })
	} as never);
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect
		.element(screen.getByText('Could not load workspace settings.', { exact: true }))
		.toBeVisible();
	getMock.mockImplementation(
		async (path) =>
			// SAFETY: Recovery supplies settings for its endpoint and empty pages for the theme catalogs.
			({
				data: path === '/theme-settings' ? settings : { items: [], next_cursor: null },
				response: new Response()
			}) as never
	);
	await screen.getByRole('button', { name: 'Try again', exact: true }).first().click();
	await expect
		.element(screen.getByRole('button', { name: 'Create theme', exact: true }))
		.toBeEnabled();
});

it('preserves a newly saved organization default when locking during a slow refresh', async () => {
	const screen = await render(
		ThemeAppearanceSettings,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await screen.getByRole('button', { name: 'Test Notebook', exact: true }).click();
	await screen.getByText('Organization default', { exact: true }).first().click();
	let finish: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		finish = resolve;
	});
	getMock.mockImplementation(async (path) => {
		await held;
		// SAFETY: Held requests return settings or an empty theme page according to their route.
		return {
			data: path === '/theme-settings' ? settings : { items: [], next_cursor: null },
			response: new Response()
		} as never;
	});
	putMock.mockImplementation(
		async (_path, options) =>
			// SAFETY: The organization mutation returns the default and lock fields accepted by that endpoint.
			({
				data: {
					organization_id: 'org-a',
					default_reference: options?.body?.default_reference,
					assignments_locked: options?.body?.assignments_locked
				},
				response: new Response()
			}) as never
	);
	try {
		await screen.getByRole('button', { name: 'Make default', exact: true }).click();
		await screen.getByRole('switch', { name: 'Lock workspace theme selection' }).click();
		await screen.getByRole('button', { name: 'Lock and clear choices', exact: true }).click();
		await vi.waitFor(() => expect(putMock).toHaveBeenCalledTimes(2));
		expect(putMock.mock.calls[1]?.[1]?.body?.default_reference?.id).toBe('notebook');
	} finally {
		finish?.();
	}
});
