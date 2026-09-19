<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		hasContentOverride: boolean;
		hasMediaOverride: boolean;
		isUnsynced: boolean;
		uploadsPending: boolean;
		multiAccount: boolean;
		segmentStrategy?: string;
		postCount: number;
		onPreview: () => void;
		onSettings: () => void;
		onResetField: (field: 'content' | 'media') => void;
		onResync: () => void;
		onDestinationAction: (action: 'copy' | 'media') => void;
	}

	let {
		hasContentOverride,
		hasMediaOverride,
		isUnsynced,
		uploadsPending,
		multiAccount,
		segmentStrategy,
		postCount,
		onPreview,
		onSettings,
		onResetField,
		onResync,
		onDestinationAction
	}: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-2 border-b py-3">
	<Button type="button" variant="ghost" size="sm" class="h-11 md:h-9" onclick={() => onPreview()}>
		{m.compose_preview()}
	</Button>
	<Button type="button" variant="ghost" size="sm" class="h-11 md:h-9" onclick={() => onSettings()}>
		{m.compose_platform_settings()}
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
		<DropdownMenu.Content class="w-56" align="start">
			{#if hasContentOverride}
				<DropdownMenu.Item onclick={() => onResetField('content')}>
					{m.compose_reset_field()}
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
{#if segmentStrategy === 'join' && postCount > 1}
	<p class="pt-2 text-xs text-muted-foreground">
		{m.compose_segments_joined({ count: postCount })}
	</p>
{/if}
