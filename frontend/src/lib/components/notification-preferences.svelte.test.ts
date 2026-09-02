import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { notificationQueryKeys } from '@openpost/query-catalog';
import { client, type User } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import { auth } from '$lib/stores/auth';
import NotificationPreferences from './notification-preferences.svelte';
import NotificationMutes from './notification-mutes.svelte';

const mocks = {
	get: vi.fn(),
	put: vi.fn(),
	post: vi.fn(),
	delete: vi.fn(),
	showToast: vi.fn()
};
vi.spyOn(client, 'GET').mockImplementation(mocks.get);
vi.spyOn(client, 'PUT').mockImplementation(async (path, options) =>
	withResponse(await mocks.put(path, options))
);
vi.spyOn(client, 'POST').mockImplementation(async (path, options) =>
	withResponse(await mocks.post(path, options))
);
vi.spyOn(client, 'DELETE').mockImplementation(async (path, options) =>
	withResponse(await mocks.delete(path, options))
);

function withResponse<T extends object>(result: T): T & { response: Response } {
	return {
		...result,
		response:
			'response' in result && result.response instanceof Response ? result.response : new Response()
	};
}

function preferences() {
	return {
		post_published: { in_app: true, email_frequency: 'off' },
		publish_failed: { in_app: true, email_frequency: 'immediate' },
		account_needs_attention: { in_app: true, email_frequency: 'off' },
		new_engagement: { in_app: true, email_frequency: 'off' },
		new_message: { in_app: true, email_frequency: 'off' },
		reply_failed: { in_app: true, email_frequency: 'immediate' },
		workspace_invite: { in_app: true, email_frequency: 'immediate' },
		ownership_transfer: { in_app: true, email_frequency: 'immediate' },
		security_action: { in_app: true, email_frequency: 'immediate' },
		access_changed: { in_app: true, email_frequency: 'immediate' },
		critical_billing: { in_app: true, email_frequency: 'immediate' }
	};
}

function topicDefinitions() {
	const definitions: Array<[string, string, boolean, boolean, boolean]> = [
		['post_published', 'publishing', true, true, false],
		['publish_failed', 'publishing', false, true, false],
		['account_needs_attention', 'publishing', false, true, false],
		['new_engagement', 'conversations', true, true, false],
		['new_message', 'conversations', true, true, false],
		['reply_failed', 'conversations', false, true, false],
		['workspace_invite', 'workspace', false, false, true],
		['ownership_transfer', 'account', false, false, true],
		['security_action', 'account', false, false, true],
		['access_changed', 'account', false, false, true],
		['critical_billing', 'account', false, false, true]
	];
	return definitions.map(([id, group, inAppMutable, emailMutable, transactional]) => ({
		id,
		group,
		presentation_key: `notifications.event.${id}`,
		critical_in_app: !inAppMutable,
		transactional,
		in_app_mutable: inAppMutable,
		email_mutable: emailMutable,
		mute_applies: !transactional,
		email_frequencies: transactional ? ['immediate'] : ['off', 'immediate', 'daily'],
		default_preference: Object.entries(preferences()).find(([topic]) => topic === id)?.[1] ?? {
			in_app: false,
			email_frequency: 'off'
		}
	}));
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe('NotificationPreferences', () => {
	beforeEach(() => {
		queryClient.clear();
		auth.setUser(user('user-a'));
		mocks.get.mockReset();
		mocks.put.mockReset();
		mocks.post.mockReset();
		mocks.delete.mockReset();
		mocks.showToast.mockReset();
	});

	afterEach(() => {
		vi.mocked(queryClient.cancelQueries).mockRestore?.();
		vi.useRealTimers();
	});

	it('reuses a parent-owned preference query without starting a nested read', async () => {
		queryClient.setQueryData(notificationQueryKeys.preferences(), {
			mutes: [
				{
					id: 'parent-mute',
					scope: 'account',
					starts_at: '2026-08-14T11:00:00Z',
					ends_at: '2035-08-14T13:00:00Z'
				}
			]
		});

		const screen = await render(NotificationMutes, {
			notify: mocks.showToast,
			queryStatus: 'parent'
		});

		await expect.element(screen.getByLabelText('Active mutes')).toBeVisible();
		expect(mocks.get).not.toHaveBeenCalled();
	});

	it('removes an expired Mute and refreshes while the page stays open', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
		mocks.get
			.mockResolvedValueOnce({
				data: {
					mutes: [
						{
							id: 'short-mute',
							scope: 'account',
							starts_at: '2026-08-14T11:00:00Z',
							ends_at: '2026-08-14T12:00:01Z'
						}
					]
				}
			})
			.mockResolvedValue({ data: { mutes: [] } });

		const screen = await render(NotificationMutes, { notify: mocks.showToast });
		await expect.element(screen.getByLabelText('Active mutes')).toBeVisible();
		await vi.advanceTimersByTimeAsync(1_100);
		await expect.element(screen.getByLabelText('Active mutes')).not.toBeInTheDocument();
		expect(mocks.get).toHaveBeenCalledTimes(2);
	});

	it('discards a Mute that expires while its API response is in flight', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
		const response = deferred<{
			data: {
				mutes: Array<{
					id: string;
					scope: 'account';
					starts_at: string;
					ends_at: string;
				}>;
			};
		}>();
		mocks.get.mockReturnValue(response.promise);

		const screen = await render(NotificationMutes, { notify: mocks.showToast });
		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
		vi.setSystemTime(new Date('2026-08-14T12:00:02Z'));
		response.resolve({
			data: {
				mutes: [
					{
						id: 'already-expired',
						scope: 'account',
						starts_at: '2026-08-14T11:00:00Z',
						ends_at: '2026-08-14T12:00:01Z'
					}
				]
			}
		});

		await vi.waitFor(() => expect(screen.getByLabelText('Active mutes').query()).toBeNull());
	});

	it('does not restore a Mute from a stale expiry refresh response', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T12:00:00Z'));
		const staleRefresh = deferred<{
			data: {
				mutes: Array<{
					id: string;
					scope: 'account';
					starts_at: string;
					ends_at: string;
				}>;
			};
		}>();
		const lastingMute = {
			id: 'lasting-mute',
			scope: 'account' as const,
			starts_at: '2026-08-14T11:00:00Z',
			ends_at: '2026-08-14T13:00:00Z'
		};
		mocks.get
			.mockResolvedValueOnce({
				data: {
					mutes: [
						lastingMute,
						{
							id: 'short-mute',
							scope: 'account',
							starts_at: '2026-08-14T11:00:00Z',
							ends_at: '2026-08-14T12:00:01Z'
						}
					]
				}
			})
			.mockReturnValueOnce(staleRefresh.promise)
			.mockResolvedValue({ data: { mutes: [] } });
		mocks.delete.mockResolvedValue({ data: { mutes: [] } });

		const screen = await render(NotificationMutes, { notify: mocks.showToast });
		await expect.element(screen.getByLabelText('Active mutes')).toBeVisible();
		await vi.advanceTimersByTimeAsync(1_100);
		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
		await screen.getByRole('button', { name: 'End now' }).click();
		await expect.element(screen.getByLabelText('Active mutes')).not.toBeInTheDocument();

		staleRefresh.resolve({ data: { mutes: [lastingMute] } });
		await vi.waitFor(() => expect(mocks.delete).toHaveBeenCalledTimes(1));
		await expect.element(screen.getByLabelText('Active mutes')).not.toBeInTheDocument();
	});

	it('keeps concurrent End now actions independent and reconciles each completion', async () => {
		const firstEnd = deferred<{ data: { mutes: never[] } }>();
		const secondEnd = deferred<{ data: { mutes: never[] } }>();
		let serverMutes = [
			{
				id: 'first-mute',
				scope: 'account' as const,
				starts_at: '2026-08-14T11:00:00Z',
				ends_at: '2035-08-14T13:00:00Z'
			},
			{
				id: 'second-mute',
				scope: 'workspace' as const,
				workspace_id: 'workspace-1',
				workspace_name: 'Launch',
				starts_at: '2026-08-14T11:00:00Z',
				ends_at: '2035-08-14T14:00:00Z'
			}
		];
		mocks.get.mockImplementation(async () => ({ data: { mutes: serverMutes } }));
		mocks.delete.mockImplementation((_path, request) =>
			request.params.path.id === 'first-mute' ? firstEnd.promise : secondEnd.promise
		);

		const screen = await render(NotificationMutes, { notify: mocks.showToast });
		const accountItem = screen.getByRole('listitem').filter({ hasText: 'All workspaces' });
		const workspaceItem = screen.getByRole('listitem').filter({ hasText: 'Launch only' });
		await accountItem.getByRole('button', { name: 'End now' }).click();
		await workspaceItem.getByRole('button', { name: 'End now' }).click();
		await expect.element(accountItem.getByRole('button', { name: 'Ending…' })).toBeDisabled();
		await expect.element(workspaceItem.getByRole('button', { name: 'Ending…' })).toBeDisabled();

		serverMutes = serverMutes.filter((mute) => mute.id !== 'second-mute');
		secondEnd.resolve({ data: { mutes: [] } });
		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByText('Launch only')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Ending…' })).toBeDisabled();

		serverMutes = [];
		firstEnd.resolve({ data: { mutes: [] } });
		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
		await expect.element(screen.getByLabelText('Active mutes')).not.toBeInTheDocument();
	});

	it('reconciles an out-of-order Create and End now from authoritative reads', async () => {
		const createResponse = deferred<{ data: { mutes: never[] } }>();
		const endResponse = deferred<{ data: { mutes: never[] } }>();
		const originalMute = {
			id: 'original-mute',
			scope: 'account' as const,
			starts_at: '2026-08-14T11:00:00Z',
			ends_at: '2035-08-14T13:00:00Z'
		};
		const replacementMute = { ...originalMute, ends_at: '2036-08-14T13:00:00Z' };
		let serverMutes = [originalMute];
		mocks.get.mockImplementation(async () => ({ data: { mutes: serverMutes } }));
		mocks.post.mockReturnValue(createResponse.promise);
		mocks.delete.mockReturnValue(endResponse.promise);

		const screen = await render(NotificationMutes, { notify: mocks.showToast });
		await screen.getByRole('button', { name: 'Start mute' }).click();
		await screen.getByRole('button', { name: 'End now' }).click();

		serverMutes = [];
		endResponse.resolve({ data: { mutes: [] } });
		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
		await expect.element(screen.getByLabelText('Active mutes')).not.toBeInTheDocument();

		serverMutes = [replacementMute];
		createResponse.resolve({ data: { mutes: [] } });
		await vi.waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
		await expect.element(screen.getByLabelText('Active mutes')).toBeVisible();
		await expect.element(screen.getByText(/2036/)).toBeVisible();
	});

	it('does not apply a saved preference response after the actor changes during cancellation', async () => {
		const initial = notificationSettings([], 'UTC');
		const savedForOldActor = notificationSettings([], 'Europe/Lisbon');
		const currentActorSettings = notificationSettings([], 'America/New_York');
		mocks.get.mockResolvedValue({ data: initial });
		mocks.put.mockResolvedValue({ data: savedForOldActor });
		const cancellation = deferred<void>();
		const cancelSpy = vi
			.spyOn(queryClient, 'cancelQueries')
			.mockImplementationOnce(() => cancellation.promise);

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await screen.getByLabelText('Timezone').fill('Europe/Lisbon');
		await screen.getByRole('button', { name: 'Save preferences' }).click();
		await vi.waitFor(() => expect(cancelSpy).toHaveBeenCalledOnce());

		auth.setUser(user('user-b'));
		queryClient.setQueryData(notificationQueryKeys.preferences(), currentActorSettings);
		cancellation.resolve();

		await expect.element(screen.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
		expect(queryClient.getQueryData(notificationQueryKeys.preferences())).toEqual(
			currentActorSettings
		);
		expect(mocks.showToast).not.toHaveBeenCalledWith('Preferences saved.', 'success');
		cancelSpy.mockRestore();
	});

	it('does not apply a created Mute after the actor changes during cancellation', async () => {
		const initial = notificationSettings([]);
		const oldActorResult = notificationSettings([
			{
				id: 'old-actor-mute',
				scope: 'account',
				starts_at: '2026-08-14T11:00:00Z',
				ends_at: '2035-08-14T13:00:00Z'
			}
		]);
		const currentActorSettings = notificationSettings([]);
		queryClient.setQueryData(notificationQueryKeys.preferences(), initial);
		mocks.post.mockResolvedValue({ data: oldActorResult });
		const cancellation = deferred<void>();
		const cancelSpy = vi
			.spyOn(queryClient, 'cancelQueries')
			.mockImplementationOnce(() => cancellation.promise);

		const screen = await render(NotificationMutes, {
			notify: mocks.showToast,
			queryStatus: 'parent'
		});
		await screen.getByRole('button', { name: 'Start mute' }).click();
		await vi.waitFor(() => expect(cancelSpy).toHaveBeenCalledOnce());

		auth.setUser(user('user-b'));
		queryClient.setQueryData(notificationQueryKeys.preferences(), currentActorSettings);
		cancellation.resolve();

		await expect.element(screen.getByRole('button', { name: 'Start mute' })).toBeEnabled();
		expect(queryClient.getQueryData(notificationQueryKeys.preferences())).toEqual(
			currentActorSettings
		);
		expect(mocks.showToast).not.toHaveBeenCalledWith('Mute started.', 'success');
		cancelSpy.mockRestore();
	});

	it('does not apply an ended Mute after the actor changes during cancellation', async () => {
		const mute = {
			id: 'actor-a-mute',
			scope: 'account' as const,
			starts_at: '2026-08-14T11:00:00Z',
			ends_at: '2035-08-14T13:00:00Z'
		};
		const initial = notificationSettings([mute]);
		const currentActorSettings = notificationSettings([
			{ ...mute, id: 'actor-b-mute', ends_at: '2036-08-14T13:00:00Z' }
		]);
		queryClient.setQueryData(notificationQueryKeys.preferences(), initial);
		mocks.delete.mockResolvedValue({ data: notificationSettings([]) });
		const cancellation = deferred<void>();
		const cancelSpy = vi
			.spyOn(queryClient, 'cancelQueries')
			.mockImplementationOnce(() => cancellation.promise);

		const screen = await render(NotificationMutes, {
			notify: mocks.showToast,
			queryStatus: 'parent'
		});
		await screen.getByRole('button', { name: 'End now' }).click();
		await vi.waitFor(() => expect(cancelSpy).toHaveBeenCalledOnce());

		auth.setUser(user('user-b'));
		queryClient.setQueryData(notificationQueryKeys.preferences(), currentActorSettings);
		cancellation.resolve();

		await expect.element(screen.getByRole('button', { name: 'End now' })).toBeEnabled();
		expect(queryClient.getQueryData(notificationQueryKeys.preferences())).toEqual(
			currentActorSettings
		);
		expect(mocks.showToast).not.toHaveBeenCalledWith('Mute ended.', 'success');
		cancelSpy.mockRestore();
	});

	it('keeps the newest preference save and releases busy state when the Workspace changes', async () => {
		const initial = notificationSettings([], 'UTC');
		const savedForWorkspaceA = notificationSettings([], 'Europe/Lisbon');
		const savedForWorkspaceB = notificationSettings([], 'America/New_York');
		const firstSave = deferred<{ data: typeof savedForWorkspaceA }>();
		const secondSave = deferred<{ data: typeof savedForWorkspaceB }>();
		mocks.get.mockResolvedValue({ data: initial });
		mocks.put.mockReturnValueOnce(firstSave.promise).mockReturnValueOnce(secondSave.promise);

		const screen = await render(NotificationPreferences, {
			workspaceID: 'workspace-a',
			workspaceName: 'Workspace A',
			notify: mocks.showToast
		});
		const timezone = screen.getByLabelText('Timezone');
		await timezone.fill('Europe/Lisbon');
		await screen.getByRole('button', { name: 'Save preferences' }).click();
		await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledOnce());

		await screen.rerender({
			workspaceID: 'workspace-b',
			workspaceName: 'Workspace B',
			notify: mocks.showToast
		});
		await expect.element(screen.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
		await timezone.fill('America/New_York');
		await screen.getByRole('button', { name: 'Save preferences' }).click();
		secondSave.resolve({ data: savedForWorkspaceB });
		await vi.waitFor(() =>
			expect(queryClient.getQueryData(notificationQueryKeys.preferences())).toEqual(
				savedForWorkspaceB
			)
		);

		firstSave.resolve({ data: savedForWorkspaceA });
		await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(2));
		expect(queryClient.getQueryData(notificationQueryKeys.preferences())).toEqual(
			savedForWorkspaceB
		);
		expect(mocks.showToast).toHaveBeenCalledTimes(1);
	});

	it('releases Create Mute busy state when the Workspace changes', async () => {
		const initial = notificationSettings([]);
		const created = notificationSettings([
			{
				id: 'workspace-a-mute',
				scope: 'workspace',
				workspace_id: 'workspace-a',
				workspace_name: 'Workspace A',
				starts_at: '2026-08-14T11:00:00Z',
				ends_at: '2035-08-14T13:00:00Z'
			}
		]);
		const create = deferred<{ data: typeof created }>();
		queryClient.setQueryData(notificationQueryKeys.preferences(), initial);
		mocks.post.mockReturnValue(create.promise);

		const screen = await render(NotificationMutes, {
			workspaceID: 'workspace-a',
			workspaceName: 'Workspace A',
			notify: mocks.showToast,
			queryStatus: 'parent'
		});
		await screen.getByRole('button', { name: 'Start mute' }).click();
		await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
		await screen.rerender({
			workspaceID: 'workspace-b',
			workspaceName: 'Workspace B',
			notify: mocks.showToast,
			queryStatus: 'parent'
		});
		await expect.element(screen.getByRole('button', { name: 'Start mute' })).toBeEnabled();

		create.resolve({ data: created });
		await vi.waitFor(() =>
			expect(queryClient.getQueryData(notificationQueryKeys.preferences())).toEqual(created)
		);
		await expect.element(screen.getByRole('button', { name: 'Start mute' })).toBeEnabled();
		expect(mocks.showToast).not.toHaveBeenCalledWith('Mute started.', 'success');
	});

	it('releases End Mute busy state when the Workspace changes', async () => {
		const mute = {
			id: 'workspace-a-mute',
			scope: 'workspace' as const,
			workspace_id: 'workspace-a',
			workspace_name: 'Workspace A',
			starts_at: '2026-08-14T11:00:00Z',
			ends_at: '2035-08-14T13:00:00Z'
		};
		const initial = notificationSettings([mute]);
		const ended = notificationSettings([]);
		const end = deferred<{ data: typeof ended }>();
		queryClient.setQueryData(notificationQueryKeys.preferences(), initial);
		mocks.delete.mockReturnValue(end.promise);

		const screen = await render(NotificationMutes, {
			workspaceID: 'workspace-a',
			workspaceName: 'Workspace A',
			notify: mocks.showToast,
			queryStatus: 'parent'
		});
		await screen.getByRole('button', { name: 'End now' }).click();
		await expect.element(screen.getByRole('button', { name: 'Ending…' })).toBeDisabled();
		await screen.rerender({
			workspaceID: 'workspace-b',
			workspaceName: 'Workspace B',
			notify: mocks.showToast,
			queryStatus: 'parent'
		});
		await expect.element(screen.getByRole('button', { name: 'End now' })).toBeEnabled();

		end.resolve({ data: ended });
		await expect.element(screen.getByLabelText('Active mutes')).not.toBeInTheDocument();
		expect(mocks.showToast).not.toHaveBeenCalledWith('Mute ended.', 'success');
	});

	it('settles an unauthorized preference save before touching cached or visible state', async () => {
		mocks.get.mockResolvedValue({ data: notificationSettings([]) });
		mocks.put.mockResolvedValue({
			error: { status: 401, detail: 'Signed out' },
			response: new Response(null, { status: 401 })
		});
		let authenticated = true;
		const unsubscribe = auth.subscribe((state) => (authenticated = state.isAuthenticated));

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await screen.getByLabelText('Timezone').fill('Europe/Lisbon');
		await screen.getByRole('button', { name: 'Save preferences' }).click();

		await vi.waitFor(() => expect(authenticated).toBe(false));
		expect(queryClient.getQueryData(notificationQueryKeys.preferences())).toBeUndefined();
		expect(mocks.showToast).not.toHaveBeenCalled();
		unsubscribe();
	});

	it('creates and ends a visible Workspace Mute without changing saved preferences', async () => {
		await page.viewport(390, 844);
		const initial = preferences();
		let serverMutes: Array<{
			id: string;
			scope: 'workspace';
			workspace_id: string;
			workspace_name: string;
			starts_at: string;
			ends_at: string;
		}> = [];
		mocks.get.mockImplementation(async () => ({
			data: {
				preferences: initial,
				topic_definitions: topicDefinitions(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'Europe/Lisbon',
				digest_configured: true,
				mutes: serverMutes
			}
		}));
		mocks.post.mockImplementation(async (_path, request) => {
			serverMutes = [
				{
					id: 'mute-workspace',
					scope: 'workspace',
					workspace_id: 'workspace-1',
					workspace_name: 'Launch',
					starts_at: '2026-08-14T12:00:00Z',
					ends_at: request.body.ends_at
				}
			];
			return {
				data: {
					preferences: initial,
					topic_definitions: topicDefinitions(),
					email_available: true,
					email_address: 'founder@example.com',
					digest_time: '09:00',
					digest_timezone: 'Europe/Lisbon',
					digest_configured: true,
					mutes: serverMutes
				}
			};
		});
		mocks.delete.mockImplementation(async () => {
			serverMutes = [];
			return {
				data: {
					preferences: initial,
					topic_definitions: topicDefinitions(),
					email_available: true,
					email_address: 'founder@example.com',
					digest_time: '09:00',
					digest_timezone: 'Europe/Lisbon',
					digest_configured: true,
					mutes: []
				}
			};
		});

		const screen = await render(NotificationPreferences, {
			props: {
				workspaceID: 'workspace-1',
				workspaceName: 'Launch',
				notify: mocks.showToast
			}
		});
		await screen.getByLabelText('Mute scope').click();
		await screen.getByRole('option', { name: 'Launch only' }).click();
		const future = new Date(Date.now() + 60 * 60 * 1000);
		const local = new Date(future.getTime() - future.getTimezoneOffset() * 60 * 1000)
			.toISOString()
			.slice(0, 16);
		await screen.getByLabelText('End time').fill(local);
		await screen.getByRole('button', { name: 'Start mute' }).click();

		expect(mocks.post).toHaveBeenCalledWith('/notifications/mutes', {
			body: {
				scope: 'workspace',
				workspace_id: 'workspace-1',
				ends_at: expect.any(String)
			}
		});
		const activeMutes = screen.getByLabelText('Active mutes');
		await expect.element(activeMutes.getByText('Launch only')).toBeVisible();
		await expect.element(screen.getByText(/Optional email paused until/)).toBeVisible();
		await screen.getByRole('button', { name: 'End now' }).click();
		expect(mocks.delete).toHaveBeenCalledWith('/notifications/mutes/{id}', {
			params: { path: { id: 'mute-workspace' } }
		});
		await expect.element(screen.getByLabelText('Active mutes')).not.toBeInTheDocument();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
	});

	it('lets a person choose email delivery on a phone-sized screen', async () => {
		await page.viewport(390, 844);
		const initial = preferences();
		mocks.get.mockResolvedValue({
			data: {
				preferences: initial,
				topic_definitions: topicDefinitions(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'Europe/Lisbon',
				digest_configured: true
			}
		});
		mocks.put.mockImplementation(async (_path, request) => ({
			data: {
				preferences: request.body.preferences,
				topic_definitions: topicDefinitions(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: request.body.digest_time,
				digest_timezone: request.body.digest_timezone,
				digest_configured: true
			}
		}));

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await expect
			.element(screen.getByText('Email notifications go to founder@example.com.'))
			.toBeVisible();
		const emailMessage = screen.getByLabelText('New message · Email frequency').nth(1);
		await expect.element(emailMessage).toHaveTextContent('Off');
		await emailMessage.click();
		await screen.getByRole('option', { name: 'Daily' }).click();
		await screen.getByRole('button', { name: 'Save preferences' }).click();

		expect(mocks.put).toHaveBeenCalledWith('/notifications/preferences', {
			body: {
				preferences: {
					...initial,
					new_message: { in_app: true, email_frequency: 'daily' }
				},
				digest_time: '09:00',
				digest_timezone: 'Europe/Lisbon'
			}
		});
		expect(mocks.showToast).toHaveBeenCalledWith('Preferences saved.', 'success');
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
	});

	it('explains when email is unavailable and keeps email choices disabled', async () => {
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				topic_definitions: topicDefinitions(),
				email_available: false,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'UTC',
				digest_configured: false
			}
		});

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await expect
			.element(
				screen.getByText(
					'Email delivery is not configured on this OpenPost instance. Your email choices will take effect when an administrator configures it.'
				)
			)
			.toBeVisible();
		await expect
			.element(screen.getByLabelText('Publish failed · Email frequency').nth(1))
			.toBeDisabled();
	});

	it('keeps saved preferences visible through a background error and clears the notice on retry', async () => {
		const saved = {
			preferences: preferences(),
			topic_definitions: topicDefinitions(),
			email_available: true,
			email_address: 'founder@example.com',
			digest_time: '09:00',
			digest_timezone: 'Europe/Lisbon',
			digest_configured: true,
			mutes: []
		};
		mocks.get.mockResolvedValueOnce({ data: saved }).mockResolvedValueOnce({
			error: { detail: 'Preferences refresh failed' },
			response: new Response(null, { status: 400 })
		});

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await expect
			.element(screen.getByText('Email notifications go to founder@example.com.'))
			.toBeVisible();

		await queryClient.invalidateQueries({
			queryKey: notificationQueryKeys.preferences(),
			exact: true
		});

		await expect.element(screen.getByText('Preferences refresh failed')).toBeVisible();
		await expect
			.element(screen.getByText('Email notifications go to founder@example.com.'))
			.toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible();

		mocks.get.mockResolvedValue({ data: saved });
		await screen.getByRole('button', { name: 'Try again' }).click();
		await expect.element(screen.getByText('Preferences refresh failed')).not.toBeInTheDocument();
	});

	it('defaults only a new choice to 09:00 in the browser timezone', async () => {
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				topic_definitions: topicDefinitions(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'UTC',
				digest_configured: false
			}
		});

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await expect.element(screen.getByLabelText('Daily digest time')).toHaveValue('09:00');
		await expect
			.element(screen.getByLabelText('Timezone'))
			.toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
	});

	it('shows the saved digest window and frequency controls on desktop', async () => {
		await page.viewport(1280, 900);
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				topic_definitions: topicDefinitions(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '16:45',
				digest_timezone: 'America/New_York',
				digest_configured: true
			}
		});

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await expect.element(screen.getByLabelText('Daily digest time')).toHaveValue('16:45');
		await expect.element(screen.getByLabelText('Timezone')).toHaveValue('America/New_York');
		await expect
			.element(screen.getByLabelText('New message · Email frequency').first())
			.toBeVisible();
		await expect
			.element(screen.getByLabelText('Security action · Email frequency').first())
			.toBeDisabled();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1280);
	});

	it('maps preference validation failures to localized copy', async () => {
		mocks.get.mockResolvedValue({
			data: {
				preferences: preferences(),
				topic_definitions: topicDefinitions(),
				email_available: true,
				email_address: 'founder@example.com',
				digest_time: '09:00',
				digest_timezone: 'UTC',
				digest_configured: true
			}
		});
		mocks.put.mockResolvedValue({
			error: { status: 400, detail: 'digest timezone is invalid' }
		});

		const screen = await render(NotificationPreferences, { notify: mocks.showToast });
		await screen.getByLabelText('Timezone').fill('Not/AZone');
		await screen.getByRole('button', { name: 'Save preferences' }).click();
		expect(mocks.showToast).toHaveBeenCalledWith(
			'Check the email frequencies, digest time, and IANA timezone, then try again.',
			'error'
		);
	});
});

function notificationSettings(
	mutes: Array<{
		id: string;
		scope: 'account' | 'workspace';
		workspace_id?: string;
		workspace_name?: string;
		starts_at: string;
		ends_at: string;
	}>,
	timezone = 'UTC'
) {
	return {
		preferences: preferences(),
		topic_definitions: topicDefinitions(),
		email_available: true,
		email_address: 'founder@example.com',
		digest_time: '09:00',
		digest_timezone: timezone,
		digest_configured: true,
		mutes
	};
}

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
