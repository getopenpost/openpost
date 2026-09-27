<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	let {
		workspaceId,
		mediaId,
		label,
		avatar = false,
		accept = ['image/png', 'image/jpeg', 'image/webp'],
		onchange
	}: {
		workspaceId: string;
		mediaId?: string;
		label: string;
		avatar?: boolean;
		accept?: string[];
		onchange: (id: string | undefined) => void;
	} = $props();
	let open = $state(false);
</script>

<div class="flex min-w-0 items-center gap-2">
	{#if mediaId}<img
			src={getAuthenticatedMediaByID(mediaId)}
			alt={label}
			class="size-10 shrink-0 object-cover"
			class:rounded-full={avatar}
			class:rounded-md={!avatar}
		/>{/if}
	<Button
		variant="outline"
		size="sm"
		class="h-auto min-h-8 min-w-0 flex-1 py-2 whitespace-normal"
		onclick={() => (open = true)}
		aria-label={label}
	>
		<ThemeIcon role="image" class="size-4 shrink-0" /><span class="min-w-0 [overflow-wrap:anywhere]"
			>{label}</span
		>
	</Button>
	{#if mediaId}<Button
			variant="ghost"
			size="icon-sm"
			aria-label={m.templates_remove_photo({ label })}
			onclick={() => onchange(undefined)}><ThemeIcon role="delete" class="size-4" /></Button
		>{/if}
</div>
{#if open}<MediaPicker
		bind:open
		{workspaceId}
		{accept}
		multiple={false}
		maxSelection={1}
		showCreate={false}
		title={label}
		currentSelection={mediaId ? [mediaId] : []}
		onConfirm={(ids) => {
			if (ids[0]) onchange(ids[0]);
		}}
	/>{/if}
