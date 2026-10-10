import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import CalendarPage from './+page.svelte';

// Component tests do not populate the SvelteKit page store, so provide its public readable contract.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('http://localhost/calendar') }) };
});

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/navigation', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$app/navigation')>();
	return { ...actual, goto: vi.fn() };
});

afterEach(() => {
	queryClient.clear();
	vi.restoreAllMocks();
});

function seedWorkspace() {
	const workspace = {
		id: 'workspace-a',
		name: 'Workspace',
		avatar_url: '',
		color: '',
		can_edit: true,
		role: 'admin' as const,
		created_at: '',
		organization_id: '',
		organization_name: '',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
	// Set both so the calendar skips initialize(), which would overwrite the fixture.
	workspaceCtx.workspaces = [workspace];
	workspaceCtx.currentWorkspace = workspace;
}

function scheduledPublication() {
	return {
		id: 'publication-calendar-1',
		workspace_id: 'workspace-a',
		title: 'Launch week post',
		source_text: 'Launch week post',
		intent: 'post',
		status: 'scheduled',
		scheduled_at: new Date().toISOString(),
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		segments: [],
		renditions: [
			{
				id: 'rendition-1',
				platform: 'x',
				status: 'scheduled',
				social_account_id: 'account-1',
				target_key: 'profile'
			},
			{
				id: 'rendition-2',
				platform: 'linkedin',
				status: 'scheduled',
				social_account_id: 'account-2',
				target_key: 'profile'
			}
		]
	};
}

function mockCalendarReads(publication: ReturnType<typeof scheduledPublication>) {
	vi.spyOn(client, 'GET').mockImplementation(async (path) => {
		if (path === '/publications') {
			// SAFETY: the overloaded GET mock cannot express the publications-list union; the cast
			// bridges the calendar fixture whose renditions the account stacks read.
			return {
				data: [publication],
				response: new Response(null, { headers: { 'X-Total-Count': '1' } })
			} as never;
		}
		// SAFETY: All other reads in this calendar fixture return empty lists.
		return { data: [] } as never;
	});
}

async function renderCalendar(publication: ReturnType<typeof scheduledPublication>) {
	queryClient.clear();
	seedWorkspace();
	mockCalendarReads(publication);
	return render(
		CalendarPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
}

it('names month-grid publication buttons with their account count', async () => {
	const screen = await renderCalendar(scheduledPublication());
	// Fails without the fix: the button is named only by the publication title.
	const item = screen.getByRole('button', { name: 'Launch week post · 2 accounts' });
	await expect.element(item).toBeVisible();
});

it('announces the day-drawer account count as text instead of an ignored label', async () => {
	const screen = await renderCalendar(scheduledPublication());
	await screen.getByRole('button', { name: /View 1 posts on/ }).click();
	// The drawer stack is decorative (aria-hidden); the sr-only label carries the count.
	// toHaveTextContent is used because screen-reader-only text is not visible.
	await expect.element(screen.getByTestId('calendar-day-drawer')).toHaveTextContent('2 accounts');
});

it('filters by connected account identity within one platform', async () => {
	queryClient.clear();
	seedWorkspace();
	const first = scheduledPublication();
	first.title = 'Launch account post';
	first.renditions = [first.renditions[0]];
	const second = scheduledPublication();
	second.id = 'publication-calendar-2';
	second.title = 'Lessons account post';
	second.renditions = [
		{ ...second.renditions[0], id: 'rendition-other', social_account_id: 'account-2' }
	];
	vi.spyOn(client, 'GET').mockImplementation(async (path) => {
		if (path === '/publications') {
			// SAFETY: The overloaded GET signature cannot express this publication fixture; it contains only calendar inventory fields.
			return {
				data: [first, second],
				response: new Response(null, { headers: { 'X-Total-Count': '2' } })
			} as never;
		}
		if (path === '/accounts') {
			// SAFETY: Connected account identity and label are the only fields this calendar read uses.
			return {
				data: [
					{
						id: 'account-1',
						platform: 'x',
						alias: 'Launch account',
						account_username: 'founder',
						is_active: true
					},
					{
						id: 'account-2',
						platform: 'x',
						alias: 'Lessons account',
						account_username: 'founder',
						is_active: true
					}
				]
			} as never;
		}
		// SAFETY: Other calendar discovery endpoints return empty lists in this fixture.
		return { data: [] } as never;
	});
	const screen = await render(
		CalendarPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	await expect
		.element(screen.getByRole('button', { name: 'Launch account post · 1 account' }))
		.toBeVisible();
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await screen.getByRole('button', { name: 'Accounts', exact: true }).click();
	await screen.getByRole('menuitemcheckbox', { name: 'Lessons account', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Launch account post · 1 account' }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Lessons account post · 1 account' }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: /^Accounts/ }).click();
	await screen.getByRole('menuitemcheckbox', { name: 'Launch account', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Launch account post · 1 account' }))
		.not.toBeInTheDocument();
	await screen.getByRole('button', { name: /^Accounts/ }).click();
	await screen.getByRole('menuitem', { name: 'All accounts', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Launch account post · 1 account' }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Lessons account post · 1 account' }))
		.toBeVisible();
});
