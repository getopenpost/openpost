<script lang="ts">
	import { CalendarDate } from '@internationalized/date';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { parseNaturalScheduleInput } from './compose/schedule-language';
	import { workspaceClock, workspaceScheduleToISO } from './compose/schedule-timezone';

	interface Props {
		open?: boolean;
		selectedDate?: CalendarDate;
		selectedTime?: string | null;
		timeSlots: string[];
		timezone: string;
		weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
		selectedDisplay: string;
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
		timeSlots,
		timezone,
		weekStartsOn,
		selectedDisplay,
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
		onClear?.();
	}

	function selectTime(time: string) {
		if (!selectedDate) {
			const today = workspaceClock(timezone).date;
			selectedDate = new CalendarDate(today.year, today.month, today.day);
		}
		selectedTime = time;
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
		open = false;
		await onSchedule();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		data-testid="schedule-dialog-shell"
		class="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
	>
		<Dialog.Header
			class="shrink-0 border-b px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 text-left"
		>
			<Dialog.Title class="text-xl font-semibold">{m.compose_schedule()}</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				{m.compose_schedule_timezone({ timezone })}
			</Dialog.Description>
		</Dialog.Header>

		<div
			data-testid="schedule-dialog-body"
			class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5"
		>
			{#if !canSchedule}
				<InlineNotice tone="warning" message={m.compose_schedule_needs_destination()} />
			{/if}
			<form
				class="space-y-2"
				onsubmit={(event) => {
					event.preventDefault();
					applyScheduleInput();
				}}
			>
				<Input
					bind:value={scheduleInput}
					placeholder={m.compose_schedule_input_placeholder()}
					class="h-10 bg-muted/40 text-base"
					aria-label={m.compose_schedule_time()}
				/>
				{#if inputError || externalError}
					<p class="px-1 text-xs text-destructive">{inputError || externalError}</p>
				{/if}
			</form>

			<div class="space-y-2">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{m.compose_quick_schedule()}
				</p>
				<div class="grid gap-2 sm:grid-cols-3">
					<Button
						type="button"
						variant="secondary"
						class="h-10 justify-center gap-2"
						onclick={onSuggest}
						disabled={suggesting}
					>
						{#if suggesting}
							<LoaderIcon class="size-4 animate-spin" />
						{:else}
							<ArrowRightIcon class="size-4" />
						{/if}
						{m.compose_next_free_slot()}
					</Button>
					<Button
						type="button"
						variant="secondary"
						class="h-10 justify-center"
						onclick={selectTomorrow}
					>
						{m.compose_tomorrow_time({ time: '09:00' })}
					</Button>
					<Button
						type="button"
						variant="secondary"
						class="h-10 justify-center"
						onclick={selectInThreeHours}
					>
						{m.compose_in_three_hours()}
					</Button>
				</div>
			</div>

			<div
				class="overflow-hidden rounded-lg border bg-muted/15 sm:grid sm:h-92 sm:grid-cols-[minmax(0,1fr)_9rem]"
			>
				<div class="flex justify-center p-3 sm:p-4">
					<Calendar
						type="single"
						bind:value={selectedDate}
						minValue={workspaceClock(timezone).date}
						numberOfMonths={1}
						pagedNavigation
						class="bg-transparent p-0 [--cell-size:--spacing(9)]"
						weekdayFormat="short"
						{weekStartsOn}
					/>
				</div>
				<div class="border-t sm:flex sm:min-h-0 sm:flex-col sm:border-t-0 sm:border-l">
					<div class="shrink-0 border-b px-3 py-2 text-center text-sm font-medium">
						{m.compose_time()}
					</div>
					<div
						data-testid="schedule-dialog-time-list"
						class="max-h-52 overflow-y-auto p-2 sm:max-h-none sm:min-h-0 sm:flex-1"
					>
						{#if timeSlots.length === 0}
							<p class="px-2 py-6 text-center text-xs text-muted-foreground">
								{m.compose_no_remaining_slots_today()}
							</p>
						{:else}
							<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-1">
								{#each timeSlots as time (time)}
									<Button
										type="button"
										variant={selectedTime === time ? 'default' : 'ghost'}
										size="sm"
										onclick={() => selectTime(time)}
										class="h-9 justify-center text-sm tabular-nums"
									>
										{time}
									</Button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>

			{#if randomDelayOptions.length > 0}
				<details class="group rounded-lg border bg-muted/10">
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
								<div class="text-sm font-medium">{m.compose_randomize_time()}</div>
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

			<div class="flex flex-wrap items-center justify-between gap-3 text-sm">
				<div class="text-muted-foreground">
					{selectedDate && selectedTime
						? m.compose_selected_schedule({ schedule: selectedDisplay })
						: m.compose_select_date_time()}
				</div>
				{#if selectedDate || selectedTime}
					<Button type="button" variant="ghost" size="sm" onclick={clearSchedule}>
						{m.compose_clear_schedule()}
					</Button>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="shrink-0 border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
			<Button type="button" variant="outline" onclick={close}>{m.common_cancel()}</Button>
			<Button
				type="button"
				onclick={schedule}
				disabled={submitting ||
					!canSchedule ||
					(!scheduleInput.trim() && (!selectedDate || !selectedTime))}
			>
				{#if submitting}<LoaderIcon class="mr-2 size-4 animate-spin" />{/if}
				{m.compose_schedule()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
