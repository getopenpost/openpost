<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { analyticsCalendarPresetRange, type AnalyticsRangeDays } from '@openpost/query-catalog';
	interface Props {
		days: AnalyticsRangeDays;
		from?: string;
		to?: string;
		onchange: (days: AnalyticsRangeDays, from: string, to: string) => void;
	}
	let { days, from = '', to = '', onchange }: Props = $props();
	const presets: AnalyticsRangeDays[] = [7, 30, 90, 365, 0];
	let open = $state(false);
	let draftFrom = $state('');
	let draftTo = $state('');
	let custom = $state(false);
	const today = () => new Date().toISOString().slice(0, 10);
	const valid = $derived(
		Boolean(draftFrom && draftTo && draftFrom <= draftTo && draftTo <= today())
	);
	const label = $derived(
		from && to
			? m.analytics_range_dates({ from: formatDate(from), to: formatDate(to) })
			: presetLabel(days)
	);
	function formatDate(value: string) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')))
			return value;
		return new Intl.DateTimeFormat(getLocaleTag(), {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(value + 'T00:00:00Z'));
	}
	function presetLabel(value: AnalyticsRangeDays) {
		return value === 0
			? m.analytics_range_all()
			: value === 365
				? m.analytics_range_year()
				: m.analytics_range_days({ days: value });
	}
	function opened(value: boolean) {
		open = value;
		if (value) {
			custom = Boolean(from);
			draftFrom = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
			draftTo = to || today();
		}
	}
	function choose(value: AnalyticsRangeDays) {
		onchange(value, '', '');
		open = false;
	}
	function apply() {
		if (!valid) return;
		onchange(30, draftFrom, draftTo);
		open = false;
	}
</script>

<Popover.Root {open} onOpenChange={opened}>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				size="sm"
				class="max-w-full"
				aria-label={`${m.analytics_range_label()}: ${label}`}
			>
				<ThemeIcon role="calendar" class="size-4 shrink-0" /><span class="truncate">{label}</span
				><ThemeIcon role="chevron-down" class="size-4 shrink-0" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="end"
		collisionPadding={8}
		class="w-[min(23rem,calc(100vw-1rem))] space-y-3"
		aria-label={m.analytics_range_label()}
	>
		<div class="grid grid-cols-2 gap-1" role="group" aria-label={m.analytics_range_label()}>
			{#each ['month_to_date', 'last_month'] as preset}
				<Button
					variant="ghost"
					class="justify-start"
					onclick={() => {
						const range = analyticsCalendarPresetRange(preset as 'month_to_date' | 'last_month');
						onchange(range.days, range.from, range.to);
						open = false;
					}}
					>{preset === 'month_to_date'
						? m.analytics_month_to_date()
						: m.analytics_last_month()}</Button
				>
			{/each}
			{#each presets as value (value)}
				<Button
					variant={!from && days === value ? 'secondary' : 'ghost'}
					class="justify-start"
					aria-pressed={!from && days === value}
					onclick={() => choose(value)}>{presetLabel(value)}</Button
				>
			{/each}
			<Button
				variant={custom ? 'secondary' : 'ghost'}
				class="justify-start"
				aria-pressed={custom}
				onclick={() => (custom = true)}>{m.analytics_range_custom()}</Button
			>
		</div>
		{#if custom}
			<form
				class="space-y-3 border-t border-border pt-3"
				onsubmit={(event) => {
					event.preventDefault();
					apply();
				}}
			>
				<p class="text-xs text-muted-foreground">{m.analytics_range_custom_help()}</p>
				<div class="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
					<label class="grid min-w-0 gap-1 text-sm"
						><span>{m.media_from()}</span><Input
							type="date"
							min="0001-01-01"
							max={draftTo || today()}
							bind:value={draftFrom}
						/></label
					>
					<label class="grid min-w-0 gap-1 text-sm"
						><span>{m.media_to()}</span><Input
							type="date"
							min={draftFrom || '0001-01-01'}
							max={today()}
							bind:value={draftTo}
						/></label
					>
				</div>
				{#if !valid}<p class="text-sm text-destructive" role="status">
						{m.analytics_range_invalid()}
					</p>{/if}
				<div class="flex justify-end gap-2">
					<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button><Button
						type="submit"
						disabled={!valid}>{m.media_apply()}</Button
					>
				</div>
			</form>
		{/if}
	</Popover.Content>
</Popover.Root>
