<script lang="ts">
	import {
		notificationPreferencesQueryOptions,
		notificationQueryKeys
	} from '@openpost/query-catalog';
	import { createQuery } from '@tanstack/svelte-query';
	import { untrack } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { queryClient } from '$lib/query/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		settleQueryMutationSession,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { notificationQueryAPI } from '$lib/query/notifications';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import {
		notificationTopicDescription,
		notificationTopicEmailFrequencies,
		notificationTopicGroups,
		notificationTopicLabel,
		type NotificationTopicDefinition
	} from '$lib/notification-topics';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import NotificationMutes from '$lib/components/notification-mutes.svelte';
	import QueueReminderSettings from '$lib/components/queue-reminder-settings.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { ThemeIcon } from '$lib/themes/icons';
	import {
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT
	} from '$lib/settings-initial-load.svelte';

	type ChannelPreference = components['schemas']['ChannelPreference'];
	type Preferences = Record<string, ChannelPreference>;
	type EmailFrequency = 'off' | 'immediate' | 'daily';

	let {
		workspaceID = '',
		workspaceName = '',
		canEditQueue = false,
		notify = showToast
	}: {
		workspaceID?: string;
		workspaceName?: string;
		canEditQueue?: boolean;
		notify?: typeof showToast;
	} = $props();

	let saving = $state(false);
	let saveRequestSequence = 0;
	let saveViewRevision = 0;
	let mutationWorkspaceID = '';
	let preferences = $state.raw<Preferences>({});
	let topicDefinitions = $state.raw<NotificationTopicDefinition[]>([]);
	const eventGroups = $derived(notificationTopicGroups(topicDefinitions));
	let savedSnapshot = $state('');
	let emailAvailable = $state(false);
	let emailAddress = $state('');
	let digestTime = $state('09:00');
	let digestTimezone = $state('UTC');
	const dirty = $derived(
		JSON.stringify({ preferences, digest_time: digestTime, digest_timezone: digestTimezone }) !==
			savedSnapshot
	);
	const preferencesQuery = createQuery(
		() => notificationPreferencesQueryOptions(notificationQueryAPI),
		() => queryClient
	);
	const loading = $derived(preferencesQuery.isPending && !preferencesQuery.data);
	const initialError = $derived(
		preferencesQuery.isError && !preferencesQuery.data
			? queryErrorMessage(preferencesQuery.error)
			: ''
	);
	const staleError = $derived(
		preferencesQuery.isError && preferencesQuery.data
			? queryErrorMessage(preferencesQuery.error)
			: ''
	);
	const reportInitialLoad = registerSettingsInitialLoad(
		SETTINGS_INITIAL_LOAD_PARTICIPANT.notifications
	);
	$effect(() => reportInitialLoad(loading));
	let appliedPreferences: components['schemas']['PreferenceSettings'] | undefined;

	$effect(() => {
		const nextWorkspaceID = workspaceID;
		if (nextWorkspaceID === mutationWorkspaceID) return;
		untrack(() => {
			mutationWorkspaceID = nextWorkspaceID;
			saveViewRevision += 1;
			saving = false;
		});
	});

	$effect(() => {
		const data = preferencesQuery.data;
		if (!data || data === appliedPreferences || (savedSnapshot && dirty)) return;
		untrack(() => {
			appliedPreferences = data;
			applyPreferences(data);
		});
	});

	function applyPreferences(data: components['schemas']['PreferenceSettings']) {
		preferences = data.preferences;
		topicDefinitions = data.topic_definitions ?? [];
		digestTime = data.digest_configured ? data.digest_time : '09:00';
		digestTimezone = data.digest_configured
			? data.digest_timezone
			: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		savedSnapshot = JSON.stringify({
			preferences: data.preferences,
			digest_time: digestTime,
			digest_timezone: digestTimezone
		});
		emailAvailable = data.email_available;
		emailAddress = data.email_address;
	}

	function preferenceFor(definition: NotificationTopicDefinition): ChannelPreference {
		return preferences[definition.id] ?? definition.default_preference;
	}

	function preferenceForID(eventType: string): ChannelPreference {
		const definition = topicDefinitions.find((candidate) => candidate.id === eventType);
		return preferences[eventType] ?? definition?.default_preference ?? fallbackPreference();
	}

	function fallbackPreference(): ChannelPreference {
		return { in_app: false, email_frequency: 'off' };
	}

	function updateInApp(eventType: string, enabled: boolean) {
		preferences = {
			...preferences,
			[eventType]: { ...preferenceForID(eventType), in_app: enabled }
		};
	}

	function updateEmailFrequency(eventType: string, frequency: string | undefined) {
		const parsedFrequency = parseEmailFrequency(frequency);
		if (!parsedFrequency) return;
		preferences = {
			...preferences,
			[eventType]: {
				...preferenceForID(eventType),
				email_frequency: parsedFrequency
			}
		};
	}

	function parseEmailFrequency(frequency: string | undefined): EmailFrequency | null {
		switch (frequency) {
			case 'off':
			case 'immediate':
			case 'daily':
				return frequency;
			default:
				return null;
		}
	}

	async function save() {
		const view = {
			session: captureQueryMutationSession(),
			requestSequence: ++saveRequestSequence,
			viewRevision: saveViewRevision,
			workspaceID
		} satisfies {
			session: QueryMutationSession;
			requestSequence: number;
			viewRevision: number;
			workspaceID: string;
		};
		saving = true;
		try {
			const {
				data,
				error: apiError,
				response
			} = await client.PUT('/notifications/preferences', {
				body: {
					preferences,
					digest_time: digestTime,
					digest_timezone: digestTimezone
				}
			});
			if (!settleQueryMutationSession(view.session, response)) return;
			if (apiError || !data) {
				if (saveViewIsCurrent(view)) {
					notify(
						apiError?.status === 400
							? m.notifications_preferences_invalid()
							: m.notifications_preferences_save_failed(),
						'error'
					);
				}
				return;
			}
			const reconciled = await reconcileQueryMutation(queryClient, view.session, {
				cancel: [{ queryKey: notificationQueryKeys.preferences(), exact: true }],
				reconcile: () => {
					if (view.requestSequence !== saveRequestSequence) return;
					queryClient.setQueryData(notificationQueryKeys.preferences(), data);
				}
			});
			if (!reconciled || !saveViewIsCurrent(view)) return;
			applyPreferences(data);
			notify(m.notifications_preferences_saved(), 'success');
		} finally {
			if (view.requestSequence === saveRequestSequence && view.viewRevision === saveViewRevision) {
				saving = false;
			}
		}
	}

	function saveViewIsCurrent(view: {
		session: QueryMutationSession;
		requestSequence: number;
		viewRevision: number;
		workspaceID: string;
	}) {
		return (
			view.requestSequence === saveRequestSequence &&
			view.viewRevision === saveViewRevision &&
			view.workspaceID === workspaceID &&
			queryMutationSessionIsCurrent(view.session)
		);
	}

	function queryErrorMessage(cause: unknown) {
		return cause instanceof Error && cause.message
			? cause.message
			: m.notifications_preferences_load_failed();
	}

	function frequencyLabel(frequency: string) {
		if (frequency === 'daily') return m.notifications_email_frequency_daily();
		if (frequency === 'immediate') return m.notifications_email_frequency_immediate();
		return m.notifications_email_frequency_off();
	}
</script>

{#snippet emailFrequencyControl(
	definition: NotificationTopicDefinition,
	preference: ChannelPreference,
	triggerClass: string
)}
	<Select.Root
		type="single"
		value={preference.email_frequency}
		disabled={!emailAvailable || !definition.email_mutable}
		onValueChange={(value) => updateEmailFrequency(definition.id, value)}
	>
		<Select.Trigger
			class={triggerClass}
			aria-label={`${notificationTopicLabel(definition.id)} · ${m.notifications_email_frequency()}`}
		>
			{frequencyLabel(preference.email_frequency)}
		</Select.Trigger>
		<Select.Content>
			{#each notificationTopicEmailFrequencies(definition) as frequency (frequency)}
				<Select.Item value={frequency}>{frequencyLabel(frequency)}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

{#if loading}
	<PageLoading layout="list" label={m.common_loading()} items={5} />
{:else if initialError}
	<InlineNotice tone="error" message={initialError}>
		{#snippet actions()}
			<Button variant="outline" size="sm" onclick={() => void preferencesQuery.refetch()}
				>{m.common_retry()}</Button
			>
		{/snippet}
	</InlineNotice>
{:else}
	<div class="space-y-6">
		{#if staleError}
			<InlineNotice tone="error" message={staleError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void preferencesQuery.refetch()}
						>{m.common_retry()}</Button
					>
				{/snippet}
			</InlineNotice>
		{/if}
		<SectionHeader
			title={m.notifications_delivery_heading()}
			description={m.notifications_delivery_description()}
			themeIconRole="notification"
		/>

		<NotificationMutes {workspaceID} {workspaceName} {notify} queryStatus="parent" />

		{#if emailAvailable}
			<p class="text-sm text-muted-foreground">
				{m.notifications_email_recipient({ email: emailAddress })}
			</p>
		{:else}
			<InlineNotice tone="warning" message={m.notifications_email_unavailable()} />
		{/if}

		<div class="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-medium" for="notification-digest-time">
					{m.notifications_digest_time()}
				</label>
				<Input id="notification-digest-time" bind:value={digestTime} type="time" required />
			</div>
			<div class="space-y-2">
				<label class="text-sm font-medium" for="notification-digest-timezone">
					{m.notifications_digest_timezone()}
				</label>
				<Input
					id="notification-digest-timezone"
					bind:value={digestTimezone}
					autocomplete="off"
					required
					placeholder="Europe/Lisbon"
				/>
			</div>
			<p class="text-xs leading-5 text-muted-foreground sm:col-span-2">
				{m.notifications_digest_help()}
			</p>
		</div>

		<div class="hidden overflow-hidden rounded-lg border md:block">
			<table class="w-full table-fixed text-sm">
				<thead class="border-b bg-muted/35 text-left">
					<tr>
						<th class="px-4 py-3 font-medium">{m.notifications_event()}</th>
						<th class="w-28 px-4 py-3 text-center font-medium">
							{m.notifications_in_app()}
						</th>
						<th class="w-44 px-4 py-3 text-center font-medium">
							{m.notifications_email_frequency()}
						</th>
					</tr>
				</thead>
				{#each eventGroups as group (group.id)}
					<tbody class="divide-y border-b last:border-b-0">
						<tr class="bg-muted/20">
							<th colspan="3" scope="rowgroup" class="px-4 py-2 text-left text-xs font-semibold">
								{group.label}
							</th>
						</tr>
						{#each group.topics as definition (definition.id)}
							{@const eventType = definition.id}
							{@const preference = preferenceFor(definition)}
							<tr>
								<th scope="row" class="px-4 py-3 text-left font-normal">
									<span class="block font-medium">{notificationTopicLabel(eventType)}</span>
									<span class="mt-0.5 block text-xs leading-5 text-muted-foreground">
										{notificationTopicDescription(eventType)}
									</span>
								</th>
								<td class="px-4 py-3 text-center">
									<span class="inline-flex min-h-11 min-w-11 items-center justify-center">
										<Checkbox
											checked={preference.in_app}
											disabled={!definition.in_app_mutable}
											aria-label={`${notificationTopicLabel(eventType)} · ${m.notifications_in_app()}`}
											onCheckedChange={(checked) => updateInApp(eventType, checked)}
										/>
									</span>
								</td>
								<td class="px-4 py-3 text-center">
									{@render emailFrequencyControl(definition, preference, '')}
								</td>
							</tr>
						{/each}
					</tbody>
				{/each}
			</table>
		</div>

		<div class="divide-y rounded-lg border md:hidden">
			{#each eventGroups as group (group.id)}
				<section aria-labelledby={`notification-group-${group.id}`}>
					<h2
						id={`notification-group-${group.id}`}
						class="border-b bg-muted/20 px-4 py-2 text-xs font-semibold"
					>
						{group.label}
					</h2>
					<div class="divide-y">
						{#each group.topics as definition (definition.id)}
							{@const eventType = definition.id}
							{@const preference = preferenceFor(definition)}
							<div class="space-y-3 px-4 py-4">
								<div>
									<p class="text-sm font-medium">{notificationTopicLabel(eventType)}</p>
									<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
										{notificationTopicDescription(eventType)}
									</p>
								</div>
								<div class="grid grid-cols-2 gap-3">
									<label
										class="flex min-h-11 items-center gap-3 rounded-md bg-muted/30 px-3 text-sm"
									>
										<Checkbox
											checked={preference.in_app}
											disabled={!definition.in_app_mutable}
											aria-label={`${notificationTopicLabel(eventType)} · ${m.notifications_in_app()}`}
											onCheckedChange={(checked) => updateInApp(eventType, checked)}
										/>
										{m.notifications_in_app()}
									</label>
									{@render emailFrequencyControl(definition, preference, 'min-h-11 w-full')}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>

		<p class="text-xs leading-5 text-muted-foreground">{m.notifications_critical_help()}</p>

		<SettingsFormFooter
			label={m.notifications_save_preferences()}
			savingLabel={m.notifications_saving_preferences()}
			{saving}
			disabled={!dirty}
			onSave={() => void save()}
		/>
	</div>
{/if}

{#if canEditQueue && workspaceID}
	<QueueReminderSettings {workspaceID} {notify} />
{/if}
