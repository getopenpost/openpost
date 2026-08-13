<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import SendIcon from '@lucide/svelte/icons/send';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	interface Props {
		scheduleLabel: string;
		quickScheduleLabel: string;
		publishLabel: string;
		deleteLabel?: string;
		busy?: boolean;
		deleting?: boolean;
		quickScheduleBusy?: boolean;
		scheduleSelected?: boolean;
		canOpenSchedule?: boolean;
		canQuickSchedule?: boolean;
		canPublish?: boolean;
		class?: string;
		onSchedule: () => void;
		onQuickSchedule: () => void | Promise<void>;
		onPublish: () => void | Promise<void>;
		onDelete?: (event: MouseEvent) => void | Promise<void>;
	}

	let {
		scheduleLabel,
		quickScheduleLabel,
		publishLabel,
		deleteLabel = '',
		busy = false,
		deleting = false,
		quickScheduleBusy = false,
		scheduleSelected = false,
		canOpenSchedule = true,
		canQuickSchedule = true,
		canPublish = true,
		class: className = '',
		onSchedule,
		onQuickSchedule,
		onPublish,
		onDelete
	}: Props = $props();
</script>

<div
	class={cn('flex min-w-0 items-center justify-end gap-1.5 md:gap-2', className)}
	data-testid="composer-action-controls"
>
	{#if onDelete}
		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="size-11 shrink-0 text-muted-foreground hover:text-destructive md:size-8"
			disabled={busy || deleting}
			onclick={onDelete}
			title={deleteLabel}
			aria-label={deleteLabel}
			data-testid="composer-delete"
		>
			{#if deleting}
				<LoaderIcon class="size-4 animate-spin" />
			{:else}
				<Trash2Icon class="size-4" />
			{/if}
		</Button>
	{/if}
	<div class="flex min-w-0">
		<Button
			type="button"
			variant="outline"
			size="sm"
			class="h-11 min-w-0 gap-1.5 rounded-r-none border-r-0 px-3 md:h-8"
			disabled={busy || !canOpenSchedule}
			onclick={onSchedule}
			title={scheduleLabel}
		>
			<CalendarClockIcon class="size-3.5 shrink-0" />
			<span class="truncate">{scheduleLabel}</span>
		</Button>
		<Button
			type="button"
			variant="outline"
			size="icon"
			class="size-11 shrink-0 rounded-l-none md:size-8"
			disabled={busy || quickScheduleBusy || !canQuickSchedule}
			onclick={onQuickSchedule}
			title={quickScheduleLabel}
			aria-label={quickScheduleLabel}
		>
			{#if busy || quickScheduleBusy}
				<LoaderIcon class="size-3.5 animate-spin" />
			{:else if scheduleSelected}
				<SendIcon class="size-3.5" />
			{:else}
				<ArrowRightIcon class="size-3.5" />
			{/if}
		</Button>
	</div>
	<Button
		type="button"
		size="sm"
		class="h-11 min-w-0 gap-1.5 px-3 md:h-8"
		disabled={busy || !canPublish}
		onclick={onPublish}
	>
		{#if busy}
			<LoaderIcon class="size-3.5 shrink-0 animate-spin" />
		{:else}
			<SendIcon class="size-3.5 shrink-0" />
		{/if}
		<span class="truncate">{publishLabel}</span>
	</Button>
</div>
