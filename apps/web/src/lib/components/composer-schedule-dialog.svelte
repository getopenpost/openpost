<script lang="ts">
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { Button } from '$lib/components/ui/button';
	import { Calendar, Day } from '$lib/components/ui/calendar';
	import { Label } from '$lib/components/ui/label';
	import { createQuery } from '@tanstack/svelte-query';
	import { schedulingPublicationsQueryOptions } from '@openpost/query-catalog';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import { createDelayedVisibility } from '$lib/query/presentation.svelte';
	import { publicationCalendarOccurrence } from '$lib/publication-calendar';
	import { mediaUsageStatusLabel } from '$lib/media-presentation';
	import { getLocaleTag } from '$lib/i18n';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as Popover from '$lib/components/ui/popover';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { parseNaturalScheduleInput } from './compose/schedule-language';
	import {
		workspaceClock,
		workspaceScheduleToISO,
		workspaceDateKeyFromISO
	} from './compose/schedule-timezone';

	interface Props {
		open?: boolean;
		selectedDate?: CalendarDate;
		selectedTime?: string | null;
		workspaceId: string;
		timeSlots: string[];
		timezone: string;
		weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
		externalError?: string;
		suggesting?: boolean;
		submitting?: boolean;
		canSchedule?: boolean;
		randomDelayOverride?: string;
		randomDelayOptions?: number[];
		defaultRandomDelayMinutes?: number;
		onSuggest: () => void | Promise<void>;
		onSchedule: () => void | Promise<void>;
		onClear?: () => void;
	}

	let {
		open = $bindable(false),
		selectedDate = $bindable<CalendarDate | undefined>(undefined),
		selectedTime = $bindable<string | null>(null),
		workspaceId,
		timeSlots,
		timezone,
		weekStartsOn,
		externalError = '',
		suggesting = false,
		submitting = false,
		canSchedule = true,
		randomDelayOverride = $bindable('default'),
		randomDelayOptions = [],
		defaultRandomDelayMinutes = 0,
		onSuggest,
		onSchedule,
		onClear
	}: Props = $props();

	let scheduleInput = $state('');
	let inputError = $state('');
	let timeSlotsOpen = $state(false);
	let browsedDate = $state<CalendarDate>();
	let visibleMonth = $state<DateValue>();
	const isPastDay = $derived(
		Boolean(browsedDate && browsedDate.compare(workspaceClock(timezone).date) < 0)
	);
	const agendaDate = $derived(browsedDate ?? workspaceClock(timezone).date);
	const agendaDateLabel = $derived(
		agendaDate.toDate(timezone).toLocaleDateString(getLocaleTag(), {
			weekday: 'long',
			month: 'short',
			day: 'numeric',
			timeZone: timezone
		})
	);
	const calendarRange = $derived.by(() => {
		const month = visibleMonth ?? workspaceClock(timezone).date;
		const start = new CalendarDate(month.year, month.month, 1);
		return {
			calendarFrom: workspaceScheduleToISO(start.subtract({ days: 6 }), '00:00', timezone) ?? '',
			calendarBefore:
				workspaceScheduleToISO(start.add({ months: 1, days: 7 }), '00:00', timezone) ?? '',
			limit: 100,
			allPages: true
		};
	});
	const postsQuery = createQuery(() => ({
		...schedulingPublicationsQueryOptions(schedulingQueryAPI, workspaceId, calendarRange),
		enabled:
			open && Boolean(workspaceId && calendarRange.calendarFrom && calendarRange.calendarBefore)
	}));
	const showLoading = createDelayedVisibility(() => open && postsQuery.isPending);
	const entries = $derived.by(() =>
		(postsQuery.data ?? [])
			.flatMap((post) => {
				const occursAt = publicationCalendarOccurrence(post);
				if (post.workspace_id !== workspaceId || !occursAt) return [];
				return [{ post, occursAt, date: workspaceDateKeyFromISO(occursAt, timezone) }];
			})
			.sort((a, b) => a.occursAt.localeCompare(b.occursAt))
	);
	const dayEntries = $derived(entries.filter((entry) => entry.date === agendaDate.toString()));
	const postsPerDay = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const entry of entries) {
			if (entry.date) counts.set(entry.date, (counts.get(entry.date) ?? 0) + 1);
		}
		return counts;
	});

	$effect(() => {
		if (!open || isPastDay) timeSlotsOpen = false;
	});

	$effect(() => {
		if (!open) return;
		const date = selectedDate ?? workspaceClock(timezone).date;
		browsedDate = date;
		visibleMonth = date;
	});

	function browseDate(date: DateValue | undefined) {
		if (!date) return;
		browsedDate = new CalendarDate(date.year, date.month, date.day);
		if (date.compare(workspaceClock(timezone).date) >= 0) selectedDate = browsedDate;
		scheduleInput = '';
		inputError = '';
	}

	function formatPostTime(occursAt: string) {
		return new Date(occursAt).toLocaleTimeString(getLocaleTag(), {
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			timeZone: timezone
		});
	}
	const effectiveRandomDelayMinutes = $derived.by(() => {
		if (randomDelayOverride === 'default') return defaultRandomDelayMinutes;
		const value = Number(randomDelayOverride);
		return Number.isFinite(value) ? Math.max(0, Math.round(value)) : defaultRandomDelayMinutes;
	});

	function formatRandomDelay(minutes: number): string {
		if (!Number.isFinite(minutes) || minutes <= 0) return m.compose_exact_time();
		if (minutes === 1) return m.compose_random_delay_one_minute();
		if (minutes === 60) return m.compose_random_delay_one_hour();
		return m.compose_random_delay_minutes({ minutes });
	}

	function applyScheduleInput(): boolean {
		const trimmed = scheduleInput.trim();
		if (!trimmed) {
			inputError = '';
			return true;
		}
		const parsed = parseNaturalScheduleInput(trimmed, new Date(), timezone);
		if (!parsed) {
			inputError = m.compose_parse_time_failed();
			return false;
		}
		if (!workspaceScheduleToISO(parsed.date, parsed.time, timezone)) {
			inputError = m.compose_invalid_timezone_time();
			return false;
		}
		selectedDate = parsed.date;
		selectedTime = parsed.time;
		scheduleInput = '';
		inputError = '';
		return true;
	}

	function clearSchedule() {
		selectedDate = undefined;
		selectedTime = null;
		scheduleInput = '';
		inputError = '';
		browsedDate = undefined;
		onClear?.();
	}

	function selectTime(time: string) {
		if (isPastDay) return;
		if (!selectedDate) {
			const today = workspaceClock(timezone).date;
			selectedDate = new CalendarDate(today.year, today.month, today.day);
		}
		selectedTime = time;
		timeSlotsOpen = false;
		scheduleInput = '';
		inputError = '';
	}

	function selectTomorrow() {
		const tomorrow = workspaceClock(timezone).date.add({ days: 1 });
		selectedDate = new CalendarDate(tomorrow.year, tomorrow.month, tomorrow.day);
		selectedTime = '09:00';
		scheduleInput = '';
		inputError = '';
	}

	function selectInThreeHours() {
		const parsed = parseNaturalScheduleInput('in 3 hours', new Date(), timezone);
		if (!parsed) return;
		selectedDate = parsed.date;
		selectedTime = parsed.time;
		scheduleInput = '';
		inputError = '';
	}

	function close() {
		inputError = '';
		open = false;
	}

	async function schedule() {
		if (!applyScheduleInput() || !selectedDate || !selectedTime) return;
		const scheduledAt = workspaceScheduleToISO(selectedDate, selectedTime, timezone);
		if (!scheduledAt) {
			inputError = m.compose_invalid_timezone_time();
			return;
		}
		if (new Date(scheduledAt).getTime() <= Date.now()) {
			inputError = m.compose_schedule_future();
			return;
		}
		open = false;
		await onSchedule();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		data-testid="schedule-dialog-shell"
		class="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-0.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[44rem]"
	>
		<Dialog.Header
			class="shrink-0 border-b px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 text-left"
		>
			<Dialog.Title class="text-lg font-semibold">{m.compose_schedule()}</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				{m.compose_schedule_timezone({ timezone })}
			</Dialog.Description>
		</Dialog.Header>

		<div
			data-testid="schedule-dialog-body"
			class="min-h-0 flex-1 space-y-4 overflow-y-auto py-3 sm:p-5"
		>
			{#if !canSchedule}
				<InlineNotice tone="warning" message={m.compose_schedule_needs_destination()} />
			{/if}
			<form
				class="mx-3 space-y-2 sm:mx-0"
				onsubmit={(event) => {
					event.preventDefault();
					applyScheduleInput();
				}}
			>
				<Input
					bind:value={scheduleInput}
					placeholder={m.compose_schedule_input_placeholder()}
					class="bg-muted/40 text-base sm:text-sm"
					aria-label={m.compose_schedule_time()}
				/>
				{#if inputError || externalError}
					<p class="px-1 text-xs text-destructive">
						{inputError || externalError}
					</p>
				{/if}
			</form>

			<div aria-label={m.compose_quick_schedule()} class="mx-3 flex flex-wrap gap-2 sm:mx-0">
				<Button
					type="button"
					variant="secondary"
					size="sm"
					class="gap-2"
					onclick={onSuggest}
					disabled={suggesting}
				>
					{#if suggesting}
						<ProtectedIcon icon="loading" class="size-4 animate-spin" />
					{:else}
						<ThemeIcon role="arrow-right" class="size-4" />
					{/if}
					{m.compose_next_free_slot()}
				</Button>
				<Button type="button" variant="secondary" size="sm" onclick={selectTomorrow}>
					{m.compose_tomorrow_time({ time: '09:00' })}
				</Button>
				<Button type="button" variant="secondary" size="sm" onclick={selectInThreeHours}>
					{m.compose_in_three_hours()}
				</Button>
			</div>

			<div class="grid gap-4 sm:grid-cols-[19.25rem_minmax(0,1fr)] sm:gap-5">
				<div class="min-w-0 space-y-3">
					<div class="date-picker">
						<Calendar
							type="single"
							value={browsedDate}
							onValueChange={browseDate}
							bind:placeholder={visibleMonth}
							numberOfMonths={1}
							pagedNavigation
							preventDeselect
							locale={getLocaleTag()}
							class="w-full bg-transparent p-0 [--cell-size:2.75rem]"
							{weekStartsOn}
						>
							{#snippet day({ day })}
								{@const count = postsPerDay.get(day.toString()) ?? 0}
								<Day
									class="relative focus-visible:ring-2 focus-visible:outline-none"
									title={count ? m.calendar_day_posts_summary({ count }) : undefined}
								>
									{day.day}
									{#if count > 0}<span
											aria-hidden="true"
											class="absolute bottom-1 size-1 rounded-full bg-current"
										></span>{/if}
								</Day>
							{/snippet}
						</Calendar>
					</div>
				</div>
				<section
					data-testid="schedule-dialog-agenda"
					aria-label={agendaDateLabel}
					class="mx-3 flex min-w-0 flex-col rounded-lg border bg-card p-3 sm:mx-0 sm:p-4"
				>
					<div class="flex items-baseline justify-between gap-3">
						<h2 class="text-base font-semibold">{agendaDateLabel}</h2>
						{#if postsQuery.data}<span class="shrink-0 text-xs text-muted-foreground"
								>{dayEntries.length === 1
									? m.activity_thread_post_one({ count: 1 })
									: m.calendar_day_posts_summary({ count: dayEntries.length })}</span
							>{/if}
					</div>
					{#if isPastDay}
						<p class="mt-2 text-sm text-muted-foreground">{m.compose_schedule_future()}</p>
					{:else}
						<div class="mt-3 space-y-2">
							<div class="flex items-center justify-between gap-2">
								<Label for="composer-schedule-time">{m.compose_schedule_publish_time()}</Label>
								<Popover.Root bind:open={timeSlotsOpen}>
									<Popover.Trigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" size="xs" class="gap-1.5">
												{m.compose_schedule_saved_slots()}
												<ThemeIcon role="chevron-down" class="size-3" />
											</Button>
										{/snippet}
									</Popover.Trigger>
									<Popover.Content align="end" class="w-72 p-2">
										<div data-testid="schedule-dialog-time-list" class="max-h-60 overflow-y-auto">
											{#if timeSlots.length === 0}
												<p class="p-3 text-sm text-muted-foreground">
													{m.compose_no_remaining_slots_today()}
												</p>
											{:else}
												<div class="grid grid-cols-3 gap-1">
													{#each timeSlots as time (time)}
														<Button
															type="button"
															variant={selectedTime === time ? 'default' : 'ghost'}
															size="sm"
															onclick={() => selectTime(time)}
															aria-pressed={selectedTime === time}
															class="tabular-nums">{time}</Button
														>
													{/each}
												</div>
											{/if}
										</div>
									</Popover.Content>
								</Popover.Root>
							</div>
							<div class="flex items-center gap-2">
								<Input
									id="composer-schedule-time"
									type="time"
									step="60"
									value={selectedTime ?? ''}
									oninput={(event) => selectTime(event.currentTarget.value)}
									class="h-12 text-lg font-medium tabular-nums md:text-lg"
								/>
								{#if selectedDate || selectedTime}
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={m.compose_clear_schedule()}
										title={m.compose_clear_schedule()}
										onclick={clearSchedule}><ThemeIcon role="close" class="size-4" /></Button
									>
								{/if}
							</div>
						</div>
					{/if}
					<div class="mt-4 min-h-0 border-t pt-3">
						<h3 class="mb-1 text-sm font-medium">{m.sidebar_activity()}</h3>
						{#if postsQuery.isError}
							<InlineNotice tone="error" message={m.calendar_failed_load()} />
							<Button variant="ghost" size="sm" onclick={() => postsQuery.refetch()}
								>{m.common_retry()}</Button
							>
						{/if}
						{#if showLoading.current}
							<PageLoading layout="list" items={2} label={m.common_loading()} defer={false} />
						{:else if postsQuery.data && dayEntries.length === 0}
							<p class="py-3 text-sm text-muted-foreground">{m.compose_schedule_empty_day()}</p>
						{:else}
							<ul class="max-h-56 divide-y overflow-y-auto">
								{#each dayEntries as { post, occursAt } (post.id)}
									<li class="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 py-3">
										<time
											datetime={occursAt}
											class="pt-0.5 text-xs font-medium text-muted-foreground tabular-nums"
											>{formatPostTime(occursAt)}</time
										>
										<div class="min-w-0">
											<p class="line-clamp-2 text-sm font-medium wrap-anywhere">
												{post.title || post.source_text || m.calendar_untitled_post()}
											</p>
											<p class="mt-1 text-xs text-muted-foreground">
												{mediaUsageStatusLabel(post.status)}
											</p>
											{#if post.title && post.source_text && post.source_text !== post.title}<p
													class="mt-1 line-clamp-2 text-xs wrap-anywhere text-muted-foreground"
												>
													{post.source_text}
												</p>{/if}
										</div>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</section>
			</div>

			{#if randomDelayOptions.length > 0}
				<details class="group mx-3 rounded-lg border bg-muted/10 sm:mx-0">
					<summary
						class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					>
						<span>{m.compose_randomize_time()}</span>
						<span class="text-xs font-normal text-muted-foreground"
							>{formatRandomDelay(effectiveRandomDelayMinutes)}</span
						>
					</summary>
					<div class="border-t p-3">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="space-y-1">
								<div class="text-sm font-medium">
									{m.compose_randomize_time()}
								</div>
								<div class="text-xs text-muted-foreground">
									{m.compose_workspace_default({
										delay: formatRandomDelay(defaultRandomDelayMinutes)
									})}.
									{m.compose_delay_applies_to_post()}
								</div>
							</div>
							<Select.Root
								type="single"
								value={randomDelayOverride}
								onValueChange={(value) => (randomDelayOverride = value || 'default')}
							>
								<Select.Trigger class="w-full sm:w-52">
									{randomDelayOverride === 'default'
										? m.compose_workspace_default({
												delay: formatRandomDelay(defaultRandomDelayMinutes)
											})
										: formatRandomDelay(effectiveRandomDelayMinutes)}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="default">
										{m.compose_workspace_default({
											delay: formatRandomDelay(defaultRandomDelayMinutes)
										})}
									</Select.Item>
									{#each randomDelayOptions as minutes (minutes)}
										<Select.Item value={String(minutes)}>{formatRandomDelay(minutes)}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				</details>
			{/if}
		</div>

		<Dialog.Footer
			class="shrink-0 flex-row justify-end border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
		>
			<Button type="button" variant="outline" onclick={close}>{m.common_cancel()}</Button>
			<Button
				type="button"
				onclick={schedule}
				disabled={submitting ||
					!canSchedule ||
					(!scheduleInput.trim() && (isPastDay || !selectedDate || !selectedTime))}
			>
				{#if submitting}<ProtectedIcon icon="loading" class="mr-2 size-4 animate-spin" />{/if}
				{m.compose_schedule()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.date-picker :global([role='gridcell']),
	.date-picker :global([role='columnheader']) {
		width: calc(100% / 7);
	}
	.date-picker :global([role='gridcell']),
	.date-picker :global([data-bits-day]) {
		height: 2.75rem;
	}
	.date-picker :global([data-bits-day]) {
		width: 100%;
	}
	.date-picker :global([data-calendar-grid-row]) {
		margin-top: 0;
	}
</style>
