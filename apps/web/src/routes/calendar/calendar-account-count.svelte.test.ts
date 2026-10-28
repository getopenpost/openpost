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
		can_connect: true,
		can_approve: true,
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

const AVATAR_URL = 'https://cdn.example/founder.jpg';

function mockPhotoReads(publication: ReturnType<typeof scheduledPublication>) {
	vi.spyOn(client, 'GET').mockImplementation(async (path) => {
		if (path === '/publications') {
			// SAFETY: the overloaded GET mock cannot express the publications-list union; the cast
			// bridges the calendar fixture whose renditions the account stacks read.
			return {
				data: [publication],
				response: new Response(null, { headers: { 'X-Total-Count': '1' } })
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
						account_avatar_url: AVATAR_URL,
						is_active: true
					},
					{
						id: 'account-2',
						platform: 'linkedin',
						alias: 'Company page',
						account_username: 'company',
						account_avatar_url: '',
						is_active: true
					}
				]
			} as never;
		}
		// SAFETY: All other reads in this calendar fixture return empty lists.
		return { data: [] } as never;
	});
}

it('renders the account photo for a photo-bearing account', async () => {
	queryClient.clear();
	seedWorkspace();
	mockPhotoReads(scheduledPublication());
	const screen = await render(
		CalendarPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
	// Fails without the account-count fix: the button is named only by the publication title.
	await expect
		.element(screen.getByRole('button', { name: 'Launch week post · 2 accounts' }))
		.toBeVisible();
	// Fails without the fix: calendar badges render a platform icon with no avatar image.
	const badgeImages = Array.from(screen.container.querySelectorAll('img')).filter(
		(image) => image.getAttribute('src') === AVATAR_URL
	);
	expect(badgeImages.length).toBeGreaterThan(0);
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await screen.getByRole('button', { name: /^(Accounts|All accounts)/ }).click();
	await expect
		.element(screen.getByRole('menuitemcheckbox', { name: 'Launch account', exact: true }))
		.toBeVisible();
	const filterImages = Array.from(document.querySelectorAll('img')).filter(
		(image) => image.getAttribute('src') === AVATAR_URL
	);
	expect(filterImages.length).toBeGreaterThan(0);
});

it('announces the day-drawer account count as text instead of an ignored label', async () => {
	const screen = await renderCalendar(scheduledPublication());
	await screen.getByRole('button', { name: /View 1 posts on/ }).click();
	// The drawer stack is decorative (aria-hidden); the sr-only label carries the count.
	// toHaveTextContent is used because screen-reader-only text is not visible.
	await expect.element(screen.getByTestId('calendar-day-drawer')).toHaveTextContent('2 accounts');
});

async function renderTwoAccountCalendar() {
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
	return render(
		CalendarPage,
		{},
		{ wrapper: QueryClientProvider, wrapperProps: { client: queryClient } }
	);
}

it('shows All accounts as a selected option distinct from an explicit full subset', async () => {
	const screen = await renderTwoAccountCalendar();
	await expect
		.element(screen.getByRole('button', { name: 'Launch account post · 1 account' }))
		.toBeVisible();
	const accountTrigger = () => screen.getByRole('button', { name: /^(Accounts|All accounts)/ });
	const allOption = () =>
		screen.getByRole('menuitemcheckbox', { name: 'All accounts', exact: true });
	await screen.getByRole('button', { name: 'Filters', exact: true }).click();
	await accountTrigger().click();
	// Fails without the fix: "All accounts" is a plain menuitem with no selected state,
	// so a null "all" and an explicit full subset render identically.
	await expect.element(allOption()).toHaveAttribute('aria-checked', 'true');
	// Unchecking one row from "All accounts" reports a subset with a trigger count.
	// (Selecting a row closes the menu, so reopen it for the next assertion.)
	await screen.getByRole('menuitemcheckbox', { name: 'Launch account', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Accounts (1)', exact: true }))
		.toBeVisible();
	await accountTrigger().click();
	await expect.element(allOption()).toHaveAttribute('aria-checked', 'false');
	// Selecting every row individually stays an explicit subset, never collapsing into "All".
	await screen.getByRole('menuitemcheckbox', { name: 'Launch account', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Accounts (2)', exact: true }))
		.toBeVisible();
	await accountTrigger().click();
	await expect.element(allOption()).toHaveAttribute('aria-checked', 'false');
	await expect
		.element(screen.getByRole('menuitemcheckbox', { name: 'Launch account', exact: true }))
		.toHaveAttribute('aria-checked', 'true');
	await expect
		.element(screen.getByRole('menuitemcheckbox', { name: 'Lessons account', exact: true }))
		.toHaveAttribute('aria-checked', 'true');
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
	await screen.getByRole('button', { name: 'All accounts', exact: true }).click();
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
	await screen.getByRole('menuitemcheckbox', { name: 'All accounts', exact: true }).click();
	await expect
		.element(screen.getByRole('button', { name: 'Launch account post · 1 account' }))
		.toBeVisible();
	await expect
		.element(screen.getByRole('button', { name: 'Lessons account post · 1 account' }))
		.toBeVisible();
});
