import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { QueryClientProvider } from '@tanstack/svelte-query';
import { openPostQueryKeys } from '@openpost/query-catalog';
import { client, type User, type Workspace } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import CalendarPage from './calendar/+page.svelte';
import EngagementPage from './inbox/engagement/+page.svelte';
import MessagesPage from './inbox/messages/+page.svelte';
import MediaPage from './media/+page.svelte';
import './layout.css';

// Component tests do not populate the SvelteKit page store, so provide its public readable contract.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('http://localhost/media') }) };
});

const getMock = vi.spyOn(client, 'GET');
const postMock = vi.spyOn(client, 'POST');
const putMock = vi.spyOn(client, 'PUT');
const initializeMock = vi.spyOn(workspaceCtx, 'initialize');

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('route mutation sessions', () => {
	it('removes renamed media from a search it no longer matches', async () => {
		let renamed = false;
		getMock.mockImplementation(async (path) => {
			if (path === '/media')
				return {
					data: {
						media: renamed ? [] : [mediaItem('media-search', 'report.png')],
						total: renamed ? 0 : 1
					},
					response: new Response()
				};
			if (path === '/media/tags') return { data: { tags: [], can_edit: true } };
			if (path === '/media/storage')
				return { data: { used_bytes: 0, asset_count: 1, internal_bytes: 0, limit_bytes: 0 } };
			if (path === '/image-editor/presets') return { data: { enabled: false, presets: [] } };
			return { data: [] };
		});
		const patch = vi.spyOn(client, 'PATCH').mockImplementation(async () => {
			renamed = true;
			// SAFETY: Rename checks the successful response status and does not consume response data.
			return { data: {}, response: new Response() } as never;
		});
		try {
			const screen = await renderWithQuery(MediaPage);
			await screen.getByPlaceholder('Search filename or alt text').fill('report');
			await screen.getByRole('button', { name: 'Search', exact: true }).click();
			await screen.getByText('report.png', { exact: true }).click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
			await page.getByRole('dialog').getByRole('textbox').fill('other.png');
			await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
			await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
			await expect.element(screen.getByText('other.png', { exact: true })).not.toBeInTheDocument();
			expect(patch).toHaveBeenCalledOnce();
		} finally {
			patch.mockRestore();
		}
	});

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
		putMock.mockReset();
	});

	it("does not mark the next actor's conversation as read", async () => {
		let activeConversation = conversation('Ada', 1);
		getMock.mockImplementation(async (path) => {
			if (path === '/messages') {
				return {
					data: { items: [activeConversation], total: 1, sync_states: [], next_cursor: '' }
				};
			}
			if (path === '/messages/{conversation_id}') {
				return { data: { items: [], next_cursor: '' }, response: new Response() };
			}
			if (path === '/accounts') return { data: [] };
			return { data: [] };
		});
		const markRead = deferred<{ data: Record<string, never>; response: Response }>();
		postMock.mockReturnValue(markRead.promise);

		const screen = await renderWithQuery(MessagesPage);
		const oldConversation = screen.getByRole('button', { name: /Ada/ });
		await expect.element(oldConversation).toHaveAttribute('data-unread', 'true');
		await oldConversation.click();
		await vi.waitFor(() => expect(postMock).toHaveBeenCalledOnce());

		activeConversation = conversation('Bea', 4);
		await screen.unmount();
		auth.setUser(user('user-b'));
		restoreWorkspace();
		const currentScreen = await renderWithQuery(MessagesPage);
		const currentConversation = currentScreen.getByRole('button', { name: /Bea/ });
		await expect.element(currentConversation).toHaveAttribute('data-unread', 'true');
		markRead.resolve({ data: {}, response: new Response() });

		await expect.element(currentConversation).toHaveAttribute('data-unread', 'true');
	});

	it("does not add an old actor's sent message to the current actor's thread", async () => {
		let activeConversation = conversation('Ada', 0);
		let activeMessage = directMessage('message-b', 'Current actor message');
		getMock.mockImplementation(async (path) => {
			if (path === '/messages') {
				return {
					data: { items: [activeConversation], total: 1, sync_states: [], next_cursor: '' }
				};
			}
			if (path === '/messages/{conversation_id}') {
				return { data: { items: [activeMessage], next_cursor: '' }, response: new Response() };
			}
			if (path === '/accounts') return { data: [] };
			return { data: [] };
		});
		const send = deferred<{
			data: ReturnType<typeof directMessage>;
			response: Response;
		}>();
		postMock.mockReturnValue(send.promise);

		const screen = await renderWithQuery(MessagesPage);
		await screen.getByRole('button', { name: /Ada/ }).click();
		await expect.element(screen.getByText('Current actor message')).toBeVisible();
		await screen.getByPlaceholder('Write a message…').fill('Old actor reply');
		await screen.getByRole('button', { name: 'Send', exact: true }).click();
		await vi.waitFor(() => expect(postMock).toHaveBeenCalledOnce());

		activeConversation = conversation('Bea', 0);
		activeMessage = directMessage('message-current', 'New actor thread');
		await screen.unmount();
		auth.setUser(user('user-b'));
		restoreWorkspace();
		const currentScreen = await renderWithQuery(MessagesPage);
		await currentScreen.getByRole('button', { name: /Bea/ }).click();
		await expect.element(currentScreen.getByText('New actor thread')).toBeVisible();
		send.resolve({
			data: directMessage('message-old', 'Old actor reply'),
			response: new Response()
		});

		await expect.element(currentScreen.getByText('Old actor reply')).not.toBeInTheDocument();
		await expect.element(currentScreen.getByText('New actor thread')).toBeVisible();
	});

	it('keeps the current conversation draft when an earlier send completes', async () => {
		// The conversation switcher collapses below desktop widths.
		await page.viewport(1280, 900);
		const conversations = [
			conversation('Ada', 0, 'conversation-a'),
			conversation('Bea', 0, 'conversation-b')
		];
		getMock.mockImplementation(async (path, options) => {
			if (path === '/messages') {
				return { data: { items: conversations, total: 2, sync_states: [], next_cursor: '' } };
			}
			if (path === '/messages/{conversation_id}') {
				// SAFETY: This generated client path always carries its conversation path parameter.
				const conversationID = (options as { params: { path: { conversation_id: string } } }).params
					.path.conversation_id;
				return {
					data: {
						items: [
							directMessage(
								`message-${conversationID}`,
								conversationID === 'conversation-a' ? 'Ada thread' : 'Bea thread',
								conversationID
							)
						],
						next_cursor: ''
					},
					response: new Response()
				};
			}
			if (path === '/accounts') return { data: [] };
			return { data: [] };
		});
		const send = deferred<{
			data: ReturnType<typeof directMessage>;
			response: Response;
		}>();
		postMock.mockReturnValue(send.promise);

		const screen = await renderWithQuery(MessagesPage);
		await screen.getByRole('button', { name: /Ada/ }).click();
		await expect.element(screen.getByText('Ada thread')).toBeVisible();
		const composer = screen.getByPlaceholder('Write a message…');
		await composer.fill('Reply to Ada');
		await screen.getByRole('button', { name: 'Send', exact: true }).click();
		await vi.waitFor(() => expect(postMock).toHaveBeenCalledOnce());

		await screen.getByRole('button', { name: /Bea/ }).click();
		await expect.element(screen.getByText('Bea thread')).toBeVisible();
		await composer.fill('Keep this Bea draft');
		send.resolve({
			data: directMessage('message-sent-a', 'Reply to Ada', 'conversation-a'),
			response: new Response()
		});

		await expect.element(composer).toHaveValue('Keep this Bea draft');
		await expect.element(screen.getByText('Bea thread')).toBeVisible();
	});

	it("does not apply an old actor's queued Engagement action to the current queue", async () => {
		let activeItem = engagementItem('Ada', false);
		getMock.mockImplementation(async (path) => {
			if (path === '/engagement') {
				return {
					data: { items: [activeItem], total: 1, sync_states: [], next_cursor: '' }
				};
			}
			if (path === '/publications') {
				return { data: [], response: new Response(null, { headers: { 'X-Next-Cursor': '' } }) };
			}
			if (path === '/accounts') return { data: [] };
			return { data: [] };
		});
		const like = deferred<{ data: Record<string, never>; response: Response }>();
		postMock.mockReturnValue(like.promise);

		const screen = await renderWithQuery(EngagementPage);
		await expect.element(screen.getByText('Comment from Ada')).toBeVisible();
		await screen.getByRole('button', { name: 'Like' }).click();
		await vi.waitFor(() => expect(postMock).toHaveBeenCalledOnce());

		activeItem = engagementItem('Bea', false);
		await screen.unmount();
		auth.setUser(user('user-b'));
		restoreWorkspace();
		const currentScreen = await renderWithQuery(EngagementPage);
		await expect.element(currentScreen.getByText('Comment from Bea')).toBeVisible();
		like.resolve({ data: {}, response: new Response() });

		await expect.element(currentScreen.getByRole('button', { name: 'Like' })).toBeVisible();
		await expect.element(currentScreen.getByText('Comment from Bea')).toBeVisible();
	});

	it('reconciles a Calendar move in its origin Workspace without moving the next Workspace UI', async () => {
		// The calendar grid needs a square viewport to expose the target slot.
		await page.viewport(900, 900);
		const sourceAt = futureDate(2, 10);
		const targetAt = futureDate(3, 10);
		const publications = new Map([
			[workspace.id, calendarPublication('publication-a', 'Workspace A launch', sourceAt)],
			[workspaceB.id, calendarPublication('publication-b', 'Workspace B launch', sourceAt)]
		]);
		getMock.mockImplementation(async (path) => {
			if (path === '/publications') {
				const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
				return {
					data: workspaceID ? [publications.get(workspaceID)!] : [],
					response: new Response(null, { headers: { 'X-Has-More': 'false' } })
				};
			}
			if (path === '/accounts') return { data: [] };
			return { data: [] };
		});
		const reschedule = deferred<{
			data: ReturnType<typeof calendarPublication>;
			response: Response;
		}>();
		putMock.mockReturnValue(reschedule.promise);

		const screen = await renderWithQuery(CalendarPage);
		await expect.element(screen.getByText('Workspace A launch').first()).toBeVisible();
		const source = document.querySelector<HTMLElement>('[data-calendar-item]');
		const target = document.querySelector<HTMLElement>(
			`[data-calendar-day="${targetAt.slice(0, 10)}"]`
		);
		expect(source).not.toBeNull();
		expect(target).not.toBeNull();
		const transfer = new DataTransfer();
		source!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
		target!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
		await vi.waitFor(() => expect(putMock).toHaveBeenCalledOnce());

		workspaceCtx.currentWorkspace = workspaceB;
		workspaceCtx.workspaces = [workspaceB];
		workspaceCtx.settingsWorkspaceID = workspaceB.id;
		await expect.element(screen.getByText('Workspace B launch').first()).toBeVisible();
		reschedule.resolve({
			data: { ...publications.get(workspace.id)!, scheduled_at: targetAt, revision: 2 },
			response: new Response()
		});

		await vi.waitFor(() =>
			expect(
				queryClient.getQueryData(
					openPostQueryKeys.publications.detail(workspace.id, 'publication-a')
				)
			).toMatchObject({ scheduled_at: targetAt })
		);
		await expect.element(screen.getByText('Workspace B launch').first()).toBeVisible();
		await expect.element(screen.getByText('Workspace A launch').first()).not.toBeInTheDocument();
	});

	it("does not restore old actor Media into the next actor's library", async () => {
		let activeMedia = mediaItem('media-a', 'actor-a.png');
		getMock.mockImplementation(async (path) => {
			if (path === '/media') return { data: { media: [activeMedia], total: 1 } };
			if (path === '/media/tags') return { data: { tags: [], can_edit: true } };
			if (path === '/media/storage') {
				return { data: { used_bytes: 0, asset_count: 1, internal_bytes: 0, limit_bytes: 0 } };
			}
			if (path === '/image-editor/presets') {
				return {
					data: { enabled: true, schema_version: 1, background_model_base_url: '', presets: [] }
				};
			}
			return { data: [] };
		});
		const restore = deferred<{ data: Record<string, never>; response: Response }>();
		postMock.mockReturnValue(restore.promise);

		const screen = await renderWithQuery(MediaPage);
		await screen.getByRole('button', { name: 'Trash', exact: true }).click();
		await expect.element(screen.getByText('actor-a.png')).toBeVisible();
		await screen.getByRole('button', { name: 'Restore', exact: true }).click();
		await vi.waitFor(() => expect(postMock).toHaveBeenCalledOnce());

		activeMedia = mediaItem('media-b', 'actor-b.png');
		await screen.unmount();
		auth.setUser(user('user-b'));
		restoreWorkspace();
		const currentScreen = await renderWithQuery(MediaPage);
		await currentScreen.getByRole('button', { name: 'Trash', exact: true }).click();
		await expect.element(currentScreen.getByText('actor-b.png')).toBeVisible();
		restore.resolve({ data: {}, response: new Response() });

		await expect.element(currentScreen.getByText('actor-b.png')).toBeVisible();
		await expect.element(currentScreen.getByText('actor-a.png')).not.toBeInTheDocument();
		await expect.element(currentScreen.getByText('Media restored.')).not.toBeInTheDocument();
	});
});

function restoreWorkspace() {
	workspaceCtx.currentWorkspace = workspace;
	workspaceCtx.workspaces = [workspace];
	workspaceCtx.settingsWorkspaceID = workspace.id;
}

function renderWithQuery(
	component: typeof CalendarPage | typeof MessagesPage | typeof EngagementPage | typeof MediaPage
) {
	return render(
		component,
		{},
		{
			wrapper: QueryClientProvider,
			wrapperProps: { client: queryClient }
		}
	);
}

function futureDate(days: number, hour: number): string {
	const date = new Date();
	date.setUTCHours(hour, 0, 0, 0);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString();
}

function calendarPublication(id: string, title: string, scheduledAt: string) {
	return {
		id,
		workspace_id: id === 'publication-a' ? workspace.id : workspaceB.id,
		created_by: 'user-a',
		title,
		intent: 'post',
		creation_preset: 'post',
		content_profile: 'post',
		source_text: title,
		status: 'scheduled',
		revision: 1,
		scheduled_at: scheduledAt,
		random_delay_minutes: 0,
		random_delay_inherited: true,
		metadata: {},
		created_at: '2026-09-01T10:00:00Z',
		updated_at: '2026-09-01T10:00:00Z',
		repost_override: { mode: 'inherit' },
		media: [],
		segments: [],
		renditions: []
	} satisfies components['schemas']['PublicationResponse'];
}

function mediaItem(id: string, originalFilename: string) {
	return {
		id,
		workspace_id: workspace.id,
		alt_text: '',
		analysis_status: 'ready',
		asset_kind: 'attachment',
		audio_channels: 0,
		bit_rate: 0,
		can_delete: true,
		created_at: '2026-09-01T10:00:00Z',
		duration_ms: 0,
		frame_rate: 0,
		height: 100,
		is_favorite: false,
		mime_type: 'image/png',
		original_filename: originalFilename,
		processing_progress: 100,
		processing_status: 'ready',
		public_url_status: 200,
		purge_after: '2035-09-08T10:00:00Z',
		retention_class: 'library',
		rotation: 0,
		size: 128,
		source: 'upload',
		tags: [],
		thumbnail_url: `/api/v1/media/${id}`,
		trashed_at: '2026-09-01T10:00:00Z',
		url: `/api/v1/media/${id}`,
		usage_count: 0,
		width: 100
	} satisfies components['schemas']['MediaListItem'];
}

function conversation(name: string, unreadCount: number, id = 'conversation-1') {
	return {
		id,
		workspace_id: workspace.id,
		social_account_id: 'account-a',
		platform: 'bluesky',
		remote_conversation_id: `remote-${id}`,
		counterpart_remote_id: 'person-1',
		counterpart_name: name,
		counterpart_handle: `@${name.toLowerCase()}`,
		counterpart_avatar_url: '',
		last_message_preview: `Message from ${name}`,
		last_remote_message_id: 'remote-message-1',
		unread_count: unreadCount,
		last_message_at: '2026-09-01T10:00:00Z',
		created_at: '2026-09-01T10:00:00Z',
		updated_at: '2026-09-01T10:00:00Z'
	};
}

function directMessage(id: string, body: string, conversationID = 'conversation-1') {
	return {
		id,
		workspace_id: workspace.id,
		conversation_id: conversationID,
		remote_message_id: id,
		author_remote_id: 'person-1',
		direction: 'inbound',
		body,
		attachments_json: '[]',
		send_status: 'sent',
		error_message: '',
		remote_created_at: '2026-09-01T10:00:00Z',
		created_at: '2026-09-01T10:00:00Z',
		updated_at: '2026-09-01T10:00:00Z'
	};
}

function engagementItem(name: string, liked: boolean) {
	return {
		id: 'engagement-1',
		workspace_id: workspace.id,
		rendition_id: 'rendition-1',
		social_account_id: 'account-a',
		platform: 'bluesky',
		remote_id: 'remote-engagement-1',
		parent_remote_id: '',
		conversation_remote_id: '',
		author_remote_id: 'person-1',
		author_name: name,
		author_handle: `@${name.toLowerCase()}`,
		author_avatar_url: '',
		body: `Comment from ${name}`,
		attachments: [],
		is_ours: false,
		can_reply: true,
		can_hide: true,
		can_delete: true,
		can_like: !liked,
		can_unlike: liked,
		hidden: false,
		liked,
		last_seen_at: '2026-09-01T10:00:00Z',
		remote_created_at: '2026-09-01T10:00:00Z',
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
	sso_required: false,
	sso_authenticated: true,
	sso_identity_linked: true
} satisfies Workspace;

const workspaceB = {
	...workspace,
	id: 'workspace-b',
	name: 'Workspace B'
} satisfies Workspace;

function user(id: string): User {
	return {
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
