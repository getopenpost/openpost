<script lang="ts">
	import { CalendarDays, Check, ClipboardCopy, Download, Info } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import {
		TIMEZONES,
		WEEKDAYS,
		buildPostingPlan,
		copyToClipboard,
		downloadText,
		postingPlanCsv
	} from '../../tools/_lib/tool-utils';

	const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const localTimezoneOptions = Array.from(new Set([detectedTimezone || 'UTC', ...TIMEZONES]));
	const audienceTimezoneOptions = TIMEZONES.map((timezone) => ({
		value: timezone,
		label: timezone.replaceAll('_', ' ')
	}));
	const localTimezoneSelectOptions = localTimezoneOptions.map((timezone) => ({
		value: timezone,
		label: timezone.replaceAll('_', ' ')
	}));
	let audienceTimezone = $state<string>('America/New_York');
	let localTimezone = $state<string>(detectedTimezone || 'UTC');
	let selectedDays = $state<number[]>([1, 3, 5]);
	let postsPerWeek = $state(3);
	let windowStart = $state('09:00');
	let windowEnd = $state('17:00');
	let copied = $state(false);

	const slots = $derived(
		buildPostingPlan({
			audienceTimezone,
			localTimezone,
			days: selectedDays,
			postsPerWeek,
			windowStart,
			windowEnd
		})
	);
	const validWindow = $derived(windowEnd > windowStart);
	const adjustedSlotCount = $derived(slots.filter((slot) => slot.adjustedForTimezone).length);

	function toggleDay(day: number) {
		selectedDays = selectedDays.includes(day)
			? selectedDays.filter((selected) => selected !== day)
			: [...selectedDays, day];
	}

	async function copyPlan() {
		try {
			await copyToClipboard(postingPlanCsv(slots, audienceTimezone, localTimezone));
			copied = true;
			window.setTimeout(() => (copied = false), 2200);
		} catch {
			copied = false;
		}
	}

	function exportPlan() {
		downloadText(
			'openpost-posting-plan.csv',
			postingPlanCsv(slots, audienceTimezone, localTimezone),
			'text/csv;charset=utf-8'
		);
	}
</script>

<div class="mt-8 grid gap-5 xl:grid-cols-[minmax(21rem,0.85fr)_minmax(0,1.15fr)]">
	<section class="rounded-lg border bg-card p-4 sm:p-6" aria-labelledby="planner-controls-title">
		<div
			class="flex size-10 items-center justify-center rounded-xl border bg-background text-primary"
		>
			<CalendarDays class="size-5" />
		</div>
		<h2 id="planner-controls-title" class="mt-4 text-lg font-semibold">
			Build a weekly test schedule
		</h2>
		<p class="mt-1 text-sm leading-6 text-muted-foreground">
			Choose the hours your audience is usually available. We evenly distribute a weekly schedule
			and convert each time to your timezone.
		</p>

		<div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
			<div class="grid gap-2">
				<label for="audience-timezone" class="text-sm font-medium">Audience timezone</label>
				<AppSelect
					id="audience-timezone"
					bind:value={audienceTimezone}
					options={audienceTimezoneOptions}
					class="h-11 w-full md:h-11"
					ariaLabel="Audience timezone"
				/>
			</div>

			<div class="grid gap-2">
				<label for="local-timezone" class="text-sm font-medium">Your timezone</label>
				<AppSelect
					id="local-timezone"
					bind:value={localTimezone}
					options={localTimezoneSelectOptions}
					class="h-11 w-full md:h-11"
					ariaLabel="Your timezone"
				/>
			</div>
		</div>

		<fieldset class="mt-5">
			<legend class="text-sm font-medium">Publishing days</legend>
			<div class="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7 xl:grid-cols-4">
				{#each WEEKDAYS as weekday (weekday.value)}
					<button
						type="button"
						aria-pressed={selectedDays.includes(weekday.value)}
						aria-label={weekday.label}
						class={[
							'min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors',
							selectedDays.includes(weekday.value)
								? 'border-primary bg-primary text-primary-foreground'
								: 'bg-background hover:bg-muted'
						]}
						onclick={() => toggleDay(weekday.value)}
					>
						{weekday.short}
					</button>
				{/each}
			</div>
		</fieldset>

		<div class="mt-5 grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
			<label for="posts-per-week" class="grid gap-2 text-sm font-medium">
				Posts per week
				<Input
					id="posts-per-week"
					type="number"
					bind:value={postsPerWeek}
					min="1"
					max="14"
					class="h-11"
				/>
			</label>
			<label for="audience-window-start" class="grid gap-2 text-sm font-medium">
				Window starts
				<Input id="audience-window-start" type="time" bind:value={windowStart} class="h-11" />
			</label>
			<label for="audience-window-end" class="grid gap-2 text-sm font-medium">
				Window ends
				<Input id="audience-window-end" type="time" bind:value={windowEnd} class="h-11" />
			</label>
		</div>
	</section>

	<section class="rounded-lg border bg-card p-4 sm:p-6" aria-labelledby="planner-output-title">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h2 id="planner-output-title" class="text-lg font-semibold">Your local schedule</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					Example dates use next week so daylight-saving rules are applied.
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={slots.length === 0}
					onclick={copyPlan}
				>
					{#if copied}<Check data-icon="inline-start" />{:else}<ClipboardCopy
							data-icon="inline-start"
						/>{/if}
					{copied ? 'Copied' : 'Copy CSV'}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={slots.length === 0}
					onclick={exportPlan}
				>
					<Download data-icon="inline-start" />
					Download
				</Button>
			</div>
		</div>
		<p class="sr-only" aria-live="polite">
			{copied ? 'Posting plan copied as CSV.' : ''}
		</p>

		<div
			class="mt-5 flex gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-4 text-sm leading-6"
		>
			<Info class="mt-0.5 size-4 shrink-0 text-primary" />
			<p>
				Start with these even posting times, then compare them with your own reach, replies, and
				results.
			</p>
		</div>
		{#if adjustedSlotCount > 0}
			<div
				class="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm leading-6"
			>
				{adjustedSlotCount}
				{adjustedSlotCount === 1 ? 'slot was' : 'slots were'} shifted by an audience clock change. The
				schedule shows the actual audience and local times.
			</div>
		{/if}

		{#if !validWindow}
			<div
				class="mt-5 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4 text-sm text-destructive"
			>
				The end of the audience window must be later than the start.
			</div>
		{:else if selectedDays.length === 0}
			<div class="mt-5 rounded-xl border border-dashed bg-muted/15 p-8 text-center">
				<p class="font-medium">Choose at least one publishing day.</p>
			</div>
		{:else}
			<div class="mt-5 overflow-hidden rounded-xl border">
				<div
					class="hidden grid-cols-[0.7fr_1fr_1.2fr] gap-4 border-b bg-muted/35 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:grid"
				>
					<span>Day</span>
					<span>Audience</span>
					<span>Local</span>
				</div>
				<ol class="divide-y">
					{#each slots as slot (slot.iso)}
						<li
							class="grid gap-2 px-4 py-4 sm:grid-cols-[0.7fr_1fr_1.2fr] sm:items-center sm:gap-4"
						>
							<p class="font-semibold">{slot.dayLabel}</p>
							<p class="text-sm">
								<span class="mr-2 text-xs text-muted-foreground sm:hidden">Audience</span>
								<span class="font-mono">{slot.audienceTime}</span>
								{#if slot.adjustedForTimezone}
									<span class="mt-1 block text-xs text-amber-500">
										Requested {slot.requestedAudienceTime}; clock change
									</span>
								{/if}
							</p>
							<p class="text-sm">
								<span class="mr-2 text-xs text-muted-foreground sm:hidden">Local</span>
								<span class="font-mono">{slot.localTime}</span>
							</p>
						</li>
					{/each}
				</ol>
			</div>
			<p class="mt-3 text-xs leading-5 text-muted-foreground">
				Audience times use {audienceTimezone.replaceAll('_', ' ')}. Local results use {localTimezone.replaceAll(
					'_',
					' '
				)}.
			</p>
		{/if}
	</section>
</div>
