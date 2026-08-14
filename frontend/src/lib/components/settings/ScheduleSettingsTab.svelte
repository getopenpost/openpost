<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import { runDestructiveSequence } from '$lib/destructive-action';
	import { client } from '$lib/api/client';
	import { getLocaleTag } from '$lib/i18n';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { WorkspaceContextError, workspaceCtx } from '$lib/stores/workspace.svelte';
	import { showToast } from '$lib/toast';
	import { m } from '$lib/paraglide/messages';
	import {
		getTimezoneLabel,
		type PostingSchedule,
		type ScheduleRow
	} from '../../../routes/settings/settings-data';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';

	const unsavedChanges = getOptionalUnsavedChanges();
	const weekdayFormatter = $derived(
		new Intl.DateTimeFormat(getLocaleTag(), { weekday: 'short', timeZone: 'UTC' })
	);
	const longWeekdayFormatter = $derived(
		new Intl.DateTimeFormat(getLocaleTag(), { weekday: 'long', timeZone: 'UTC' })
	);
	let saving = $state(false);
	let loadedScheduleWorkspaceID = '';
	let scheduleRequestSequence = 0;
	let removeTimeDialogOpen = $state(false);
	let pendingTimeRow = $state.raw<ScheduleRow | null>(null);

	function notify(message: string, tone: 'success' | 'error' = 'success') {
		showToast(message, tone);
	}

	function isCurrentWorkspace(workspaceID: string) {
		return workspaceCtx.currentWorkspace?.id === workspaceID;
	}

	function localizedWeekday(dayIndex: number, format: 'short' | 'long' = 'short') {
		const date = new Date(Date.UTC(2026, 6, 5 + dayIndex));
		return (format === 'long' ? longWeekdayFormatter : weekdayFormatter).format(date);
	}

	function requestRemoveTimeRow(row: ScheduleRow) {
		pendingTimeRow = row;
		removeTimeDialogOpen = true;
	}

	async function confirmRemoveTimeRow(): Promise<DestructiveActionOutcome> {
		if (!pendingTimeRow) return { ok: false };
		const result = await removeTimeRow(pendingTimeRow);
		return result;
	}

	async function saveSettings() {
		saving = true;
		try {
			await workspaceCtx.saveSettings({
				random_delay_minutes: workspaceCtx.settings.random_delay_minutes,
				draft_gap_minutes: workspaceCtx.settings.draft_gap_minutes,
				slot_start_hour: workspaceCtx.settings.slot_start_hour,
				slot_end_hour: workspaceCtx.settings.slot_end_hour,
				slot_interval_minutes: workspaceCtx.settings.slot_interval_minutes
			});
			notify(m.settings_saved());
		} catch (error) {
			notify(
				error instanceof WorkspaceContextError
					? m.settings_action_failed()
					: (error as Error).message,
				'error'
			);
		} finally {
			saving = false;
		}
	}

	function parseDurationInput(input: string, allowZero: boolean = false): number | null {
		input = input.trim().toLowerCase();
		const direct = parseInt(input, 10);
		if (!isNaN(direct) && String(direct) === input && (direct > 0 || (allowZero && direct === 0))) {
			return direct;
		}
		const hourMatch = input.match(/(\d+)\s*h/);
		const minMatch = input.match(/(\d+)\s*m/);
		let total = 0;
		if (hourMatch) total += parseInt(hourMatch[1], 10) * 60;
		if (minMatch) total += parseInt(minMatch[1], 10);
		if (total > 0) return total;
		return null;
	}

	let intervalInput = $state(String(workspaceCtx.settings.slot_interval_minutes));
	let intervalError = $state('');
	let draftGapInput = $state(String(workspaceCtx.settings.draft_gap_minutes));
	let draftGapError = $state('');

	function handleIntervalChange(value: string) {
		intervalInput = value;
		const parsed = parseDurationInput(value);
		if (parsed !== null && parsed >= 1 && parsed <= 180) {
			intervalError = '';
			workspaceCtx.settings.slot_interval_minutes = parsed;
		} else {
			intervalError = m.settings_interval_invalid();
		}
	}

	function handleDraftGapChange(value: string) {
		draftGapInput = value;
		const parsed = parseDurationInput(value, true);
		if (parsed !== null && parsed >= 0 && parsed <= 24 * 60) {
			draftGapError = '';
			workspaceCtx.settings.draft_gap_minutes = parsed;
		} else {
			draftGapError = m.settings_draft_gap_invalid();
		}
	}

	let schedules = $state<PostingSchedule[]>([]);
	let loadingSchedules = $state(false);
	let scheduleError = $state('');
	let showSuggestSchedule = $state(false);
	let suggestedPostsPerDay = $state(3);
	let generatingSchedule = $state(false);
	let newTimeInput = $state('09:00');
	let newTimeError = $state('');
	let newTimeDays = $state<number[]>([1, 2, 3, 4, 5]);
	let savedScheduleDraft = $state(JSON.stringify({ time: '09:00', days: [1, 2, 3, 4, 5] }));
	const scheduleDraftDirty = $derived(scheduleDraftSnapshot() !== savedScheduleDraft);

	$effect(() => {
		unsavedChanges?.set('schedule-draft', scheduleDraftDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('schedule-draft');
	});

	function scheduleDraftSnapshot() {
		return JSON.stringify({ time: newTimeInput, days: newTimeDays });
	}

	const dayOrder = $derived.by(() => {
		const start = workspaceCtx.settings.week_start === 0 ? 0 : 1;
		return Array.from({ length: 7 }, (_, index) => (start + index) % 7);
	});

	const scheduleRows = $derived.by(() => {
		const rows: Record<string, ScheduleRow> = {};
		for (const schedule of schedules) {
			const key = `${schedule.local_hour}:${schedule.local_minute}`;
			if (!rows[key]) {
				rows[key] = {
					key,
					local_hour: schedule.local_hour,
					local_minute: schedule.local_minute,
					label: schedule.label ?? '',
					days: {}
				};
			}
			const row = rows[key];
			row.days[schedule.local_day_of_week] = schedule;
			if (!row.label && schedule.label) {
				row.label = schedule.label;
			}
		}
		return Object.values(rows).sort(
			(a, b) => a.local_hour * 60 + a.local_minute - (b.local_hour * 60 + b.local_minute)
		);
	});

	async function loadSchedules(workspaceID = workspaceCtx.currentWorkspace?.id ?? '') {
		if (!workspaceID) return;
		const requestSequence = ++scheduleRequestSequence;
		const workspaceChanged = loadedScheduleWorkspaceID !== workspaceID;
		loadedScheduleWorkspaceID = workspaceID;
		loadingSchedules = true;
		scheduleError = '';
		if (workspaceChanged) schedules = [];
		try {
			const { data, error: err } = await client.GET('/posting-schedules', {
				params: { query: { workspace_id: workspaceID } }
			});
			if (err || !data) throw new Error(err?.detail || m.settings_schedule_load_failed());
			if (requestSequence !== scheduleRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			schedules = data;
		} catch (e) {
			if (requestSequence !== scheduleRequestSequence || !isCurrentWorkspace(workspaceID)) return;
			scheduleError = (e as Error).message || m.settings_schedule_load_failed();
			console.error('Failed to load schedules:', e);
		} finally {
			if (requestSequence === scheduleRequestSequence) loadingSchedules = false;
		}
	}

	function parseClockInput(value: string): { hour: number; minute: number } | null {
		const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
		if (!match) return null;
		const hour = Number(match[1]);
		const minute = Number(match[2]);
		if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
		return { hour, minute };
	}

	async function createSchedule(
		workspaceID: string,
		dayOfWeek: number,
		localHour: number,
		localMinute: number
	) {
		const { error: err } = await client.POST('/posting-schedules', {
			body: {
				workspace_id: workspaceID,
				local_day_of_week: dayOfWeek,
				local_hour: localHour,
				local_minute: localMinute,
				day_of_week: 0,
				utc_hour: 0,
				utc_minute: 0,
				label: ''
			}
		});
		if (err) throw err;
	}

	async function addTimeRow() {
		const parsed = parseClockInput(newTimeInput);
		if (!parsed) {
			newTimeError = m.settings_time_format_invalid();
			return;
		}
		if (newTimeDays.length === 0) {
			newTimeError = m.settings_time_day_required();
			return;
		}
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!workspaceID || !workspaceCtx.settingsReady) {
			newTimeError = m.settings_workspace_load_failed();
			return;
		}
		newTimeError = '';
		try {
			for (const day of newTimeDays) {
				const exists = schedules.some(
					(schedule) =>
						schedule.local_day_of_week === day &&
						schedule.local_hour === parsed.hour &&
						schedule.local_minute === parsed.minute
				);
				if (!exists) {
					await createSchedule(workspaceID, day, parsed.hour, parsed.minute);
				}
			}
			if (isCurrentWorkspace(workspaceID)) {
				await loadSchedules(workspaceID);
				savedScheduleDraft = scheduleDraftSnapshot();
				notify(m.settings_time_added());
			}
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		}
	}

	async function deleteSchedule(id: string) {
		try {
			const { error: err } = await client.DELETE('/posting-schedules/{id}', {
				params: { path: { id } }
			});
			if (err) throw err;
			await loadSchedules();
			notify(m.settings_schedule_deleted());
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		}
	}

	async function toggleScheduleCell(row: ScheduleRow, dayOfWeek: number) {
		try {
			const existing = row.days[dayOfWeek];
			if (existing) {
				await deleteSchedule(existing.id);
				return;
			}
			const workspaceID = workspaceCtx.currentWorkspace?.id;
			if (!workspaceID || !workspaceCtx.settingsReady) return;
			await createSchedule(workspaceID, dayOfWeek, row.local_hour, row.local_minute);
			if (isCurrentWorkspace(workspaceID)) {
				await loadSchedules(workspaceID);
				notify(m.settings_schedule_updated());
			}
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		}
	}

	async function removeTimeRow(row: ScheduleRow): Promise<DestructiveActionOutcome> {
		const targets = Object.values(row.days).filter((schedule): schedule is PostingSchedule =>
			Boolean(schedule)
		);
		const outcome = await runDestructiveSequence(targets, async (schedule) => {
			const { error: err, response } = await client.DELETE('/posting-schedules/{id}', {
				params: { path: { id: schedule.id } }
			});
			if (err && response.status !== 404) throw err;
		});
		if (outcome.error) {
			const remainingIDs = new Set(outcome.remaining.map((schedule) => schedule.id));
			if (pendingTimeRow === row) {
				pendingTimeRow = {
					...row,
					days: Object.fromEntries(
						Object.entries(row.days).filter(
							([, schedule]) => schedule && remainingIDs.has(schedule.id)
						)
					)
				};
			}
			await loadSchedules();
			const message =
				(outcome.error as { detail?: string; message?: string }).detail ||
				(outcome.error as Error).message ||
				m.settings_action_failed();
			return { ok: false, message };
		}
		await loadSchedules();
		return { ok: true, successMessage: m.settings_time_removed() };
	}

	function toggleNewDay(dayOfWeek: number) {
		if (newTimeDays.includes(dayOfWeek)) {
			newTimeDays = newTimeDays.filter((value) => value !== dayOfWeek);
			return;
		}
		newTimeDays = [...newTimeDays, dayOfWeek].sort((a, b) => a - b);
	}

	async function generateSuggestedSchedule() {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!workspaceID || !workspaceCtx.settingsReady) return;
		generatingSchedule = true;
		try {
			const { error: err } = await client.POST('/posting-schedules/suggest', {
				body: {
					workspace_id: workspaceID,
					posts_per_day: suggestedPostsPerDay
				}
			});
			if (err) throw err;
			showSuggestSchedule = false;
			if (isCurrentWorkspace(workspaceID)) {
				await loadSchedules(workspaceID);
				notify(
					suggestedPostsPerDay === 1
						? m.settings_schedule_generated_one()
						: m.settings_schedule_generated({ count: suggestedPostsPerDay })
				);
			}
		} catch (e) {
			notify((e as Error).message || m.settings_action_failed(), 'error');
		} finally {
			generatingSchedule = false;
		}
	}

	function formatTime(hour: number, minute: number): string {
		return new Date(Date.UTC(2024, 0, 1, hour, minute)).toLocaleTimeString(getLocaleTag(), {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: 'UTC'
		});
	}

	$effect(() => {
		const workspaceID = workspaceCtx.currentWorkspace?.id ?? '';
		if (workspaceID && loadedScheduleWorkspaceID !== workspaceID) void loadSchedules(workspaceID);
	});

	$effect(() => {
		intervalInput = String(workspaceCtx.settings.slot_interval_minutes);
		draftGapInput = String(workspaceCtx.settings.draft_gap_minutes);
		intervalError = '';
		draftGapError = '';
	});

	$effect(() => {
		unsavedChanges?.set(
			'schedule-settings',
			workspaceCtx.settingsDirty || scheduleDraftDirty,
			m.settings_unsaved_changes()
		);
		return () => unsavedChanges?.clear('schedule-settings');
	});
</script>

<section id="posting-schedule" class="scroll-mt-24">
	<SectionHeader
		title={m.settings_posting_schedule()}
		description={m.settings_schedule_body()}
		icon={CalendarIcon}
		class="mb-4"
	>
		{#snippet actions()}
			<Button
				onclick={() => (showSuggestSchedule = !showSuggestSchedule)}
				variant="outline"
				size="sm"
			>
				<SparklesIcon class="mr-2 h-4 w-4" />
				{m.settings_suggest_pattern()}
			</Button>
		{/snippet}
	</SectionHeader>

	<div class="mb-4 rounded-xl border bg-muted/20 p-4">
		<div class="grid gap-4 lg:grid-cols-[180px_1fr_auto]">
			<div class="space-y-2">
				<label class="text-sm font-medium" for="new-time">{m.settings_add_time_row()}</label>
				<Input id="new-time" bind:value={newTimeInput} type="time" step="900" />
			</div>
			<div class="space-y-2">
				<span class="text-sm font-medium">{m.settings_active_days()}</span>
				<div class="flex flex-wrap gap-3">
					{#each dayOrder as dayIndex (dayIndex)}
						<label
							class="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
						>
							<Checkbox
								checked={newTimeDays.includes(dayIndex)}
								onCheckedChange={() => toggleNewDay(dayIndex)}
							/>
							<span>{localizedWeekday(dayIndex)}</span>
						</label>
					{/each}
				</div>
			</div>
			<div class="flex items-end">
				<Button onclick={addTimeRow} class="w-full lg:w-auto">
					<PlusIcon class="mr-2 h-4 w-4" />
					{m.settings_add_time()}
				</Button>
			</div>
		</div>
		{#if newTimeError}
			<p class="mt-3 text-xs text-destructive">{newTimeError}</p>
		{:else}
			<p class="mt-3 text-xs text-muted-foreground">
				{m.settings_new_rows_timezone({
					timezone: getTimezoneLabel(workspaceCtx.settings.timezone)
				})}
			</p>
		{/if}
	</div>

	{#if showSuggestSchedule}
		<div class="mb-4 rounded-xl border bg-background p-4">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div class="space-y-2">
					<label class="text-sm font-medium" for="posts-per-day"
						>{m.settings_suggested_posts_day()}</label
					>
					<Select.Root
						type="single"
						value={String(suggestedPostsPerDay)}
						onValueChange={(v) => (suggestedPostsPerDay = Number(v))}
					>
						<Select.Trigger id="posts-per-day" class="w-28">
							{suggestedPostsPerDay}
						</Select.Trigger>
						<Select.Content class="max-h-60 overflow-y-auto">
							{#each Array.from({ length: 10 }, (_, i) => i + 1) as n (n)}
								<Select.Item value={String(n)}>{n}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex gap-2">
					<Button onclick={() => (showSuggestSchedule = false)} variant="outline" size="sm"
						>{m.common_cancel()}</Button
					>
					<Button onclick={generateSuggestedSchedule} size="sm" disabled={generatingSchedule}>
						{#if generatingSchedule}
							<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
						{/if}
						{m.settings_generate()}
					</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if scheduleError}
		<InlineNotice tone="error" message={scheduleError} class="mb-4">
			{#snippet actions()}
				<Button
					variant="outline"
					size="sm"
					onclick={() => void loadSchedules()}
					disabled={loadingSchedules}
				>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{/if}
	{#if loadingSchedules && scheduleRows.length === 0}
		<PageLoading layout="list" label={m.common_loading()} items={3} />
	{:else if !scheduleError && scheduleRows.length === 0}
		<div class="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
			{m.settings_no_posting_times()}
		</div>
	{:else}
		<div class="space-y-3 xl:hidden">
			{#each scheduleRows as row (row.key)}
				<div class="rounded-xl border bg-card p-4">
					<div class="mb-3 flex items-start justify-between gap-3">
						<div>
							<div class="font-medium">{formatTime(row.local_hour, row.local_minute)}</div>
							{#if row.label}
								<div class="text-xs text-muted-foreground">{row.label}</div>
							{/if}
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => requestRemoveTimeRow(row)}
							aria-label={m.settings_remove_time_row({
								time: formatTime(row.local_hour, row.local_minute)
							})}
						>
							<TrashIcon class="size-4" />
						</Button>
					</div>
					<div
						class="grid grid-cols-2 gap-2 sm:grid-cols-4"
						role="group"
						aria-label={formatTime(row.local_hour, row.local_minute)}
					>
						{#each dayOrder as dayIndex (`mobile-${row.key}-${dayIndex}`)}
							<label class="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm">
								<Checkbox
									checked={Boolean(row.days[dayIndex])}
									onCheckedChange={() => toggleScheduleCell(row, dayIndex)}
								/>
								<span>{localizedWeekday(dayIndex)}</span>
							</label>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<div class="hidden overflow-x-auto rounded-xl border xl:block">
			<div class="min-w-[680px]">
				<div class="grid grid-cols-[120px_repeat(7,minmax(56px,1fr))_52px] border-b bg-muted/30">
					<div
						class="px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
					>
						{m.settings_time()}
					</div>
					{#each dayOrder as dayIndex (dayIndex)}
						<div
							class="px-2 py-3 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase"
						>
							{localizedWeekday(dayIndex)}
						</div>
					{/each}
					<div class="px-2 py-3"></div>
				</div>

				{#each scheduleRows as row (row.key)}
					<div
						class="grid grid-cols-[120px_repeat(7,minmax(56px,1fr))_52px] border-b last:border-b-0"
					>
						<div class="px-4 py-3">
							<div class="font-medium">{formatTime(row.local_hour, row.local_minute)}</div>
							{#if row.label}
								<div class="text-xs text-muted-foreground">{row.label}</div>
							{/if}
						</div>
						{#each dayOrder as dayIndex (`${row.key}-${dayIndex}`)}
							<div class="flex items-center justify-center px-2 py-3">
								<Checkbox
									checked={Boolean(row.days[dayIndex])}
									onCheckedChange={() => toggleScheduleCell(row, dayIndex)}
									aria-label={m.settings_toggle_schedule_cell({
										day: localizedWeekday(dayIndex, 'long'),
										time: formatTime(row.local_hour, row.local_minute)
									})}
								/>
							</div>
						{/each}
						<div class="flex items-center justify-center px-2 py-3">
							<Button
								variant="ghost"
								size="icon"
								class="h-8 w-8"
								onclick={() => requestRemoveTimeRow(row)}
								aria-label={m.settings_remove_time_row({
									time: formatTime(row.local_hour, row.local_minute)
								})}
							>
								<TrashIcon class="h-4 w-4" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</section>

<section id="natural-posting" class="scroll-mt-24 space-y-4">
	<SectionHeader
		title={m.settings_advanced_scheduling()}
		description={m.settings_advanced_scheduling_body()}
		icon={ClockIcon}
		class="mb-4"
	/>
	<div class="space-y-4">
		<div class="space-y-2">
			<label class="text-sm font-medium" for="random-delay">{m.settings_time_variation()}</label>
			<Select.Root
				type="single"
				value={String(workspaceCtx.settings.random_delay_minutes)}
				onValueChange={(v) => (workspaceCtx.settings.random_delay_minutes = Number(v))}
			>
				<Select.Trigger id="random-delay" class="w-full sm:w-64">
					{#if workspaceCtx.settings.random_delay_minutes === 0}
						{m.settings_no_delay()}
					{:else}
						±{m.settings_minutes({
							minutes: workspaceCtx.settings.random_delay_minutes
						})}
					{/if}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="0">{m.settings_no_delay()}</Select.Item>
					{#each [5, 10, 15, 30, 45] as delay (delay)}
						<Select.Item value={String(delay)}
							>±{m.settings_minutes({ minutes: delay })}</Select.Item
						>
					{/each}
					<Select.Item value="60">±{m.settings_one_hour()}</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2">
			<label class="text-sm font-medium" for="draft-gap">{m.settings_queue_full()}</label>
			<Input
				id="draft-gap"
				type="text"
				value={draftGapInput}
				oninput={(e) => handleDraftGapChange((e.target as HTMLInputElement).value)}
				placeholder={m.settings_draft_gap_placeholder()}
				class={draftGapError ? 'border-destructive' : ''}
				aria-invalid={Boolean(draftGapError)}
				aria-describedby={draftGapError ? 'draft-gap-error' : undefined}
			/>
			{#if draftGapError}
				<p id="draft-gap-error" class="text-xs text-destructive">{draftGapError}</p>
			{:else}
				<p class="text-xs text-muted-foreground">
					{m.settings_queue_spillover_body({
						minutes: workspaceCtx.settings.draft_gap_minutes
					})}
				</p>
			{/if}
		</div>
	</div>
</section>

<section id="slot-defaults" class="scroll-mt-24 space-y-4">
	<SectionHeader
		title={m.settings_time_picker_range()}
		description={m.settings_time_picker_range_body()}
		icon={ClockIcon}
		class="mb-4"
	/>
	<div class="space-y-4">
		<div class="grid gap-4 sm:grid-cols-3">
			<div class="space-y-2">
				<label class="text-sm font-medium" for="start-time">{m.settings_start_time()}</label>
				<Select.Root
					type="single"
					value={String(workspaceCtx.settings.slot_start_hour)}
					onValueChange={(v) => (workspaceCtx.settings.slot_start_hour = Number(v))}
				>
					<Select.Trigger id="start-time" class="w-full">
						{workspaceCtx.settings.slot_start_hour.toString().padStart(2, '0')}:00
					</Select.Trigger>
					<Select.Content class="max-h-60 overflow-y-auto">
						{#each Array.from({ length: 24 }, (_, i) => i) as hour (hour)}
							<Select.Item value={String(hour)}>{hour.toString().padStart(2, '0')}:00</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-medium" for="end-time">{m.settings_end_time()}</label>
				<Select.Root
					type="single"
					value={String(workspaceCtx.settings.slot_end_hour)}
					onValueChange={(v) => (workspaceCtx.settings.slot_end_hour = Number(v))}
				>
					<Select.Trigger id="end-time" class="w-full">
						{workspaceCtx.settings.slot_end_hour.toString().padStart(2, '0')}:00
					</Select.Trigger>
					<Select.Content class="max-h-60 overflow-y-auto">
						{#each Array.from({ length: 24 }, (_, i) => i) as hour (hour)}
							<Select.Item value={String(hour)}>{hour.toString().padStart(2, '0')}:00</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-2">
				<label class="text-sm font-medium" for="interval">{m.settings_interval()}</label>
				<Input
					id="interval"
					type="text"
					value={intervalInput}
					oninput={(e) => handleIntervalChange((e.target as HTMLInputElement).value)}
					placeholder={m.settings_interval_placeholder()}
					class="h-9 {intervalError ? 'border-destructive' : ''}"
					aria-invalid={Boolean(intervalError)}
					aria-describedby={intervalError ? 'interval-error' : undefined}
				/>
				{#if intervalError}
					<p id="interval-error" class="text-xs text-destructive">{intervalError}</p>
				{:else}
					<p class="text-xs text-muted-foreground">
						{m.settings_current_interval({
							minutes: workspaceCtx.settings.slot_interval_minutes
						})}
					</p>
				{/if}
			</div>
		</div>
	</div>
</section>

<SettingsFormFooter
	label={m.settings_save_changes()}
	savingLabel={m.settings_save_changes()}
	{saving}
	disabled={!workspaceCtx.settingsDirty || Boolean(intervalError || draftGapError)}
	onSave={saveSettings}
/>

<DestructiveConfirmDialog
	bind:open={removeTimeDialogOpen}
	title={pendingTimeRow
		? m.settings_remove_time_title({
				time: formatTime(pendingTimeRow.local_hour, pendingTimeRow.local_minute)
			})
		: ''}
	description={m.settings_remove_time_body()}
	confirmLabel={m.settings_remove()}
	onConfirm={confirmRemoveTimeRow}
/>
