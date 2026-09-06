<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import AsyncActionButton from './async-action-button.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';

	interface Props {
		scheduleLabel: string;
		quickScheduleLabel: string;
		publishLabel: string;
		moreLabel: string;
		deleteLabel?: string;
		busy?: boolean;
		deleting?: boolean;
		quickScheduleBusy?: boolean;
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
		moreLabel,
		deleteLabel = '',
		busy = false,
		deleting = false,
		quickScheduleBusy = false,
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
	<AsyncActionButton
		type="button"
		size="sm"
		class="h-11 min-w-0 flex-1 gap-1.5 px-3 md:h-8 md:flex-none"
		disabled={!canQuickSchedule}
		state={busy || quickScheduleBusy ? 'pending' : 'idle'}
		onclick={onQuickSchedule}
		label={quickScheduleLabel}
		icon="calendar"
		title={quickScheduleLabel}
		announce={false}
		data-testid="composer-primary-delivery-action"
	/>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="outline"
					size="icon"
					class="size-11 shrink-0 md:size-8"
					disabled={busy || deleting}
					title={moreLabel}
					aria-label={moreLabel}
					data-testid="composer-delivery-menu"
				>
					<ThemeIcon role="chevron-down" class="size-3.5" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="w-56" align="end">
			<DropdownMenu.Item disabled={!canOpenSchedule} onclick={onSchedule}>
				<ThemeIcon role="calendar" class="size-4" />
				{scheduleLabel}
			</DropdownMenu.Item>
			<DropdownMenu.Item disabled={!canPublish} onclick={onPublish}>
				<ThemeIcon role="send" class="size-4" />
				{publishLabel}
			</DropdownMenu.Item>
			{#if onDelete}
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					class="text-destructive focus:text-destructive"
					disabled={deleting}
					onclick={(event) => onDelete?.(event as MouseEvent)}
					data-testid="composer-delete"
				>
					{#if deleting}
						<ProtectedIcon icon="loading" class="size-4 animate-spin" />
					{:else}
						<ThemeIcon role="delete" class="size-4" />
					{/if}
					{deleteLabel}
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
