<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		hasContentOverride: boolean;
		resetTextLabel?: string;
		hasMediaOverride: boolean;
		isUnsynced: boolean;
		uploadsPending: boolean;
		multiAccount: boolean;
		segmentStrategy?: string;
		postCount: number;
		onPreview: () => void;
		onToggleSync: () => void;
		onSettings: () => void;
		onResetField: (field: 'content' | 'media') => void;
		onResync: () => void;
		onDestinationAction: (action: 'copy' | 'media') => void;
	}

	let {
		hasContentOverride,
		resetTextLabel,
		hasMediaOverride,
		isUnsynced,
		uploadsPending,
		multiAccount,
		segmentStrategy,
		postCount,
		onPreview,
		onToggleSync,
		onSettings,
		onResetField,
		onResync,
		onDestinationAction
	}: Props = $props();
	const syncDescriptionId = $props.id();
	const contentSynced = $derived(!hasContentOverride && !hasMediaOverride);
</script>

<div class="flex shrink-0 items-center gap-1" data-testid="composer-variant-toolbar">
	<Button
		type="button"
		variant="ghost"
		size="icon"
		class="size-11 p-0 aria-pressed:bg-action-quiet-hover md:size-9"
		aria-label={m.compose_shared_content()}
		aria-pressed={contentSynced}
		aria-describedby={syncDescriptionId}
		title={contentSynced
			? `${m.compose_all_synced()}. ${m.compose_unsync()}`
			: m.compose_sync_back()}
		disabled={uploadsPending}
		onclick={onToggleSync}
	>
		<ThemeIcon role={contentSynced ? 'link' : 'unlink'} class="size-4" />
	</Button>
	<span id={syncDescriptionId} class="sr-only">
		{contentSynced ? m.compose_unsync() : m.compose_sync_back()}
	</span>
	<Button
		type="button"
		variant="ghost"
		size="sm"
		class="size-11 shrink-0 p-0 md:size-9"
		aria-label={m.compose_full_preview()}
		title={m.compose_full_preview()}
		onclick={() => onPreview()}
	>
		<ThemeIcon role="eye" class="size-4" />
	</Button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="ghost"
					size="icon"
					class="size-11 md:size-9"
					aria-label={m.sidebar_more()}
				>
					<ThemeIcon role="more-horizontal" class="size-4" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="w-56" align="end">
			{#if segmentStrategy === 'join' && postCount > 1}<DropdownMenu.Label
					class="font-normal text-muted-foreground"
					>{m.compose_segments_joined({ count: postCount })}</DropdownMenu.Label
				><DropdownMenu.Separator />{/if}
			<DropdownMenu.Item onclick={onSettings}>{m.compose_platform_settings()}</DropdownMenu.Item>
			<DropdownMenu.Separator />
			{#if hasContentOverride}
				<DropdownMenu.Item onclick={() => onResetField('content')}>
					{resetTextLabel ?? m.compose_reset_field()}
				</DropdownMenu.Item>
			{/if}
			{#if hasMediaOverride}
				<DropdownMenu.Item onclick={() => onResetField('media')}>
					{m.compose_reset_media()}
				</DropdownMenu.Item>
			{/if}
			{#if isUnsynced}
				<DropdownMenu.Item onclick={() => onResync()}>
					{m.compose_reset_destination()}
				</DropdownMenu.Item>
			{/if}
			{#if multiAccount}
				<DropdownMenu.Separator />
				<DropdownMenu.Item disabled={uploadsPending} onclick={() => onDestinationAction('media')}>
					{m.compose_apply_media()}
				</DropdownMenu.Item>
				<DropdownMenu.Item disabled={uploadsPending} onclick={() => onDestinationAction('copy')}>
					{m.compose_copy_rendition()}
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
