<script lang="ts">
	import {
		notificationQueryKeys,
		queueReminderSettingsQueryOptions
	} from '@openpost/query-catalog';
	import { createQuery } from '@tanstack/svelte-query';
	import { untrack } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		settleQueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { queryClient } from '$lib/query/client';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { notificationQueryAPI } from '$lib/query/notifications';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import {
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT
	} from '$lib/settings-initial-load.svelte';

	let {
		workspaceID,
		notify = showToast
	}: {
		workspaceID: string;
		notify?: typeof showToast;
	} = $props();

	type Settings = components['schemas']['QueueReminderSettings'];

	let lowRunwayEnabled = $state(false);
	let queueEmptiedEnabled = $state(false);
	let runwayDays = $state(7);
	let savedSnapshot = $state('');
	let appliedSettings: Settings | undefined;
	let saving = $state(false);
	let saveSequence = 0;
	let viewRevision = 0;
	let mutationWorkspaceID = '';
	const settingsQuery = createQuery(
		() => queueReminderSettingsQueryOptions(notificationQueryAPI, workspaceID),
		() => queryClient
	);
	const loading = $derived(settingsQuery.isPending && !settingsQuery.data);
	const error = $derived(
		settingsQuery.isError && !settingsQuery.data
			? settingsQuery.error instanceof Error
				? settingsQuery.error.message
				: m.notifications_queue_load_failed()
			: ''
	);
	const dirty = $derived(
		JSON.stringify({ lowRunwayEnabled, queueEmptiedEnabled, runwayDays }) !== savedSnapshot
	);
	const reportInitialLoad = registerSettingsInitialLoad(
		SETTINGS_INITIAL_LOAD_PARTICIPANT.queueReminders
	);
	$effect(() => reportInitialLoad(loading));

	$effect(() => {
		const nextWorkspaceID = workspaceID;
		if (nextWorkspaceID === mutationWorkspaceID) return;
		untrack(() => {
			mutationWorkspaceID = nextWorkspaceID;
			viewRevision += 1;
			saving = false;
			savedSnapshot = '';
			appliedSettings = undefined;
		});
	});

	$effect(() => {
		const data = settingsQuery.data;
		if (!data || data === appliedSettings || (savedSnapshot && dirty)) return;
		untrack(() => applySettings(data));
	});

	function applySettings(settings: Settings) {
		appliedSettings = settings;
		lowRunwayEnabled = settings.low_runway_enabled;
		queueEmptiedEnabled = settings.queue_emptied_enabled;
		runwayDays = settings.runway_days;
		savedSnapshot = JSON.stringify({ lowRunwayEnabled, queueEmptiedEnabled, runwayDays });
	}

	async function save() {
		const sequence = ++saveSequence;
		const revision = viewRevision;
		const targetWorkspaceID = workspaceID;
		const session = captureQueryMutationSession();
		saving = true;
		try {
			const {
				data,
				error: apiError,
				response
			} = await client.PUT('/notifications/queue-reminders/{workspace_id}', {
				params: { path: { workspace_id: targetWorkspaceID } },
				body: {
					low_runway_enabled: lowRunwayEnabled,
					queue_emptied_enabled: queueEmptiedEnabled,
					runway_days: runwayDays
				}
			});
			if (!settleQueryMutationSession(session, response)) return;
			if (apiError || !data) {
				if (viewIsCurrent(sequence, revision, targetWorkspaceID, session)) {
					notify(m.notifications_queue_save_failed(), 'error');
				}
				return;
			}
			const reconciled = await reconcileQueryMutation(queryClient, session, {
				cancel: [
					{ queryKey: notificationQueryKeys.queueReminders(targetWorkspaceID), exact: true }
				],
				reconcile: () => {
					if (sequence !== saveSequence) return;
					queryClient.setQueryData(notificationQueryKeys.queueReminders(targetWorkspaceID), data);
				}
			});
			if (!reconciled || !viewIsCurrent(sequence, revision, targetWorkspaceID, session)) return;
			applySettings(data);
			notify(m.notifications_queue_saved(), 'success');
		} finally {
			if (sequence === saveSequence && revision === viewRevision) saving = false;
		}
	}

	function viewIsCurrent(
		sequence: number,
		revision: number,
		targetWorkspaceID: string,
		session: ReturnType<typeof captureQueryMutationSession>
	) {
		return (
			sequence === saveSequence &&
			revision === viewRevision &&
			targetWorkspaceID === workspaceID &&
			queryMutationSessionIsCurrent(session)
		);
	}
</script>

<section class="space-y-4" aria-label={m.notifications_queue_heading()}>
	<SectionHeader
		title={m.notifications_queue_heading()}
		description={m.notifications_queue_description()}
		themeIconRole="calendar"
	/>

	{#if error}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => void settingsQuery.refetch()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else if settingsQuery.data}
		{#if !settingsQuery.data.activated}
			<InlineNotice tone="info" message={m.notifications_queue_inactive()} />
		{/if}

		<div class="divide-y rounded-lg border">
			<label class="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3">
				<span class="flex min-h-11 items-center">
					<Checkbox
						bind:checked={lowRunwayEnabled}
						aria-label={m.notifications_queue_low_runway()}
					/>
				</span>
				<span class="min-w-0 pt-2">
					<span class="block text-sm font-medium">{m.notifications_queue_low_runway()}</span>
					<span class="mt-0.5 block text-xs leading-5 text-muted-foreground">
						{m.notifications_queue_low_runway_description()}
					</span>
				</span>
			</label>
			<label class="flex min-h-14 cursor-pointer items-start gap-3 px-4 py-3">
				<span class="flex min-h-11 items-center">
					<Checkbox
						bind:checked={queueEmptiedEnabled}
						aria-label={m.notifications_queue_emptied()}
					/>
				</span>
				<span class="min-w-0 pt-2">
					<span class="block text-sm font-medium">{m.notifications_queue_emptied()}</span>
					<span class="mt-0.5 block text-xs leading-5 text-muted-foreground">
						{m.notifications_queue_emptied_description()}
					</span>
				</span>
			</label>
		</div>

		<div class="grid gap-2 rounded-lg border bg-muted/20 p-4 sm:max-w-md">
			<label class="text-sm font-medium" for="queue-runway-days">
				{m.notifications_queue_runway_days()}
			</label>
			<Input
				id="queue-runway-days"
				type="number"
				min="1"
				max="30"
				required
				disabled={!lowRunwayEnabled}
				bind:value={runwayDays}
			/>
			<p class="text-xs leading-5 text-muted-foreground">
				{m.notifications_queue_timezone({ timezone: settingsQuery.data.workspace_timezone })}
			</p>
		</div>

		<SettingsFormFooter
			label={m.notifications_queue_save()}
			savingLabel={m.common_saving()}
			{saving}
			disabled={!dirty || runwayDays < 1 || runwayDays > 30}
			onSave={() => void save()}
		/>
	{/if}
</section>
