import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { client, type User, type Workspace } from '$lib/api/client';
import { inboxQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import { userProfileDefaults } from '$lib/test-fixtures/user-profile';
import { pendingInboxChanges } from '$lib/test-fixtures/inbox';
import MessagesPage from './+page.svelte';
import '../../layout.css';

// Component tests do not populate the SvelteKit page store, so provide its public readable contract.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/stores', () => ({
	page: {
		subscribe(run: (value: { url: URL }) => void) {
			run({ url: new URL('http://localhost/inbox/messages') });
			return () => {};
		}
	}
}));

const getMock = vi.spyOn(client, 'GET');
const postMock = vi.spyOn(client, 'POST');
const putMock = vi.spyOn(client, 'PUT');
const initializeMock = vi.spyOn(workspaceCtx, 'initialize');

function renderMessages() {
	return render(
		MessagesPage,
		{},
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
}

function mockInbox(items: ReturnType<typeof conversation>[]) {
	getMock.mockImplementation(async (path, options?: { signal?: AbortSignal | null }) => {
		if (path === '/inbox/changes') return pendingInboxChanges(options?.signal);
		if (path === '/messages') {
			return { data: { items, total: items.length, sync_states: [], next_cursor: '' } };
		}
		if (path === '/messages/{conversation_id}') {
			return { data: { items: [], next_cursor: '' }, response: new Response() };
		}
		if (path === '/accounts') return { data: [] };
		return { data: [] };
	});
}

function rowByName(container: Element, name: string): HTMLElement {
	const rows = [...container.querySelectorAll<HTMLButtonElement>('button[data-unread]')];
	const row = rows.find((candidate) => candidate.textContent?.includes(name));
	if (!row) throw new Error(`Expected a conversation row for ${name}.`);
	return row;
}

describe('messages counterpart avatar', () => {
	beforeEach(() => {
		queryClient.clear();
		auth.setUser(user('user-a'));
		workspaceCtx.currentWorkspace = workspace;
		workspaceCtx.workspaces = [workspace];
		workspaceCtx.settingsWorkspaceID = workspace.id;
		initializeMock.mockReset();
		initializeMock.mockResolvedValue();
		getMock.mockReset();
		postMock.mockReset();
		postMock.mockResolvedValue({ response: new Response(null, { status: 204 }) });
		putMock.mockReset();
	});

	it('keeps a reader above the latest messages in place until they choose New messages', async () => {
		mockInbox([conversation('Ava Stone', 0)]);
		putMock.mockResolvedValue({ response: new Response() });
		const screen = await renderMessages();
		await vi.waitFor(() => expect(rowByName(screen.container, 'Ava Stone')).toBeTruthy());
		rowByName(screen.container, 'Ava Stone').click();
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[data-testid="message-history"]')).not.toBeNull()
		);
		const viewport = screen.container.querySelector<HTMLElement>(
			'[data-testid="message-history"]'
		)!;
		viewport.style.height = '150px';
		viewport.style.flex = 'none';
		const key = inboxQueryKeys.messages(workspace.id, 'conversation-1', { limit: 200 });
		const items = Array.from({ length: 30 }, (_, i) => directMessage(i));
		queryClient.setQueryData(key, { pages: [{ items, next_cursor: '' }], pageParams: [''] });
		await vi.waitFor(() => expect(viewport.querySelectorAll('[data-message-id]')).toHaveLength(30));
		await new Promise((resolve) => requestAnimationFrame(resolve));
		viewport.scrollTop = 0;
		viewport.dispatchEvent(new Event('scroll'));
		queryClient.setQueryData(key, {
			pages: [{ items: [...items, directMessage(30)], next_cursor: '' }],
			pageParams: ['']
		});
		await vi.waitFor(() => expect(screen.container.textContent).toContain('New messages'));
		expect(viewport.scrollTop).toBe(0);
		await screen.getByRole('button', { name: 'New messages' }).click();
		await vi.waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(0));
	});

	it('retries an interrupted send with the same receipt and reports the confirmed queue state', async () => {
		mockInbox([conversation('Ava Stone', 0)]);
		putMock.mockResolvedValue({ response: new Response() });
		const submitted: string[] = [];
		postMock.mockImplementation(
			async (path, options?: { body?: { client_operation_id?: string } }) => {
				if (path !== '/messages/{conversation_id}/send')
					return { response: new Response(null, { status: 204 }) };
				const operationId = options?.body?.client_operation_id;
				if (!operationId) throw new Error('Send receipt is missing');
				submitted.push(operationId);
				if (submitted.length === 1) throw new TypeError('Network interrupted');
				return {
					data: {
						...directMessage(40),
						direction: 'outbound',
						body: 'One intentional message',
						send_status: 'queued'
					},
					response: new Response()
				};
			}
		);
		const screen = await renderMessages();
		await vi.waitFor(() => expect(rowByName(screen.container, 'Ava Stone')).toBeTruthy());
		rowByName(screen.container, 'Ava Stone').click();
		await screen.getByRole('textbox', { name: 'Write a message…' }).fill('One intentional message');
		await screen.getByRole('button', { name: 'Send' }).click();
		await vi.waitFor(() =>
			expect(screen.container.textContent).toContain('The request was interrupted.')
		);
		await screen.getByRole('button', { name: 'Try again', exact: true }).click();
		await vi.waitFor(() => expect(submitted).toHaveLength(2));
		expect(submitted[1]).toBe(submitted[0]);
		await vi.waitFor(() => expect(screen.container.textContent).toContain('Queued'));
		expect(screen.container.querySelector('textarea')?.value).toBe('');
	});

	it('loads the counterpart photo lazily without sending a referrer', async () => {
		mockInbox([conversation('Ava Stone', 1, 'https://example.com/avatars/ava.png')]);
		const screen = await renderMessages();
		await vi.waitFor(() => {
			expect(rowByName(screen.container, 'Ava Stone').querySelector('img')).not.toBeNull();
		});
		const image = rowByName(screen.container, 'Ava Stone').querySelector('img');
		expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
		expect(image?.getAttribute('loading')).toBe('lazy');
	});
});

function conversation(name: string, unreadCount: number, avatarUrl = '') {
	return {
		id: 'conversation-1',
		workspace_id: workspace.id,
		social_account_id: 'account-a',
		platform: 'bluesky',
		remote_conversation_id: 'remote-conversation-1',
		counterpart_remote_id: 'person-1',
		counterpart_name: name,
		counterpart_handle: `@${name.toLowerCase().replace(/\s+/g, '')}`,
		counterpart_avatar_url: avatarUrl,
		last_message_preview: `Message from ${name}`,
		last_remote_message_id: 'remote-message-1',
		unread_count: unreadCount,
		last_message_at: '2026-09-01T10:00:00Z',
		created_at: '2026-09-01T10:00:00Z',
		updated_at: '2026-09-01T10:00:00Z'
	};
}

const workspace = {
	id: 'workspace-a',
	name: 'Workspace A',
	avatar_url: '',
	color: '#f97316',
	created_at: '2026-09-01T10:00:00Z',
	organization_id: '',
	organization_name: '',
	role: 'admin',
	can_edit: true,
	can_connect: true,
	can_approve: true,
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

function user(id: string): User {
	return {
		...userProfileDefaults,
		id,
		email: `${id}@example.com`,
		username: id,
		public_profile_enabled: false,
		is_admin: false,
		is_managed: false,
		has_password: true,
		legal_acceptance_required: false,
		email_verified: true,
		created_at: '2026-09-01T10:00:00Z'
	};
}

function directMessage(index: number) {
	return {
		id: `message-${index}`,
		workspace_id: workspace.id,
		conversation_id: 'conversation-1',
		social_account_id: 'account-a',
		platform: 'bluesky',
		remote_message_id: `remote-${index}`,
		author_remote_id: 'person-1',
		direction: 'inbound',
		body: `Incoming message ${index}`,
		attachments_json: '[]',
		send_status: '',
		error_message: '',
		remote_created_at: `2026-09-01T10:00:${String(index).padStart(2, '0')}Z`,
		created_at: `2026-09-01T10:00:${String(index).padStart(2, '0')}Z`,
		updated_at: '2026-09-01T10:00:00Z'
	};
}
