<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import ImagePlusIcon from 'lucide-svelte/icons/image-plus';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';

	interface Props {
		disabled?: boolean;
		uploading?: boolean;
		dragging?: boolean;
		description?: string;
		class?: string;
		onChoose: () => void;
		onDropFiles?: (files: File[]) => void | Promise<void>;
	}

	let {
		disabled = false,
		uploading = false,
		dragging = $bindable(false),
		description = m.compose_add_media(),
		class: className = '',
		onChoose,
		onDropFiles
	}: Props = $props();

	function dragOver(event: DragEvent) {
		if (disabled || !onDropFiles) return;
		event.preventDefault();
		dragging = true;
	}

	function dragLeave(event: DragEvent) {
		if (!onDropFiles) return;
		event.preventDefault();
		if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node) {
			if (event.currentTarget.contains(event.relatedTarget)) return;
		}
		dragging = false;
	}

	async function drop(event: DragEvent) {
		if (disabled || !onDropFiles) return;
		event.preventDefault();
		dragging = false;
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length > 0) await onDropFiles(files);
	}
</script>

<div
	class={cn(
		'flex min-h-36 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-5 py-6 text-center transition-colors',
		dragging
			? 'border-primary bg-primary/8'
			: 'border-border bg-muted/15 hover:border-foreground/25 hover:bg-muted/25',
		disabled && 'cursor-not-allowed opacity-60',
		className
	)}
	role="region"
	aria-label={m.media_picker_add_media()}
	ondragover={dragOver}
	ondragleave={dragLeave}
	ondrop={drop}
	data-testid="composer-media-dropzone"
>
	<div class="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
		{#if uploading}
			<LoaderIcon class="size-5 animate-spin" />
		{:else}
			<ImagePlusIcon class="size-5" />
		{/if}
	</div>
	<div class="space-y-1">
		<p class="text-sm font-medium">{m.compose_drop_media_here()}</p>
		<p class="text-sm text-muted-foreground">{description}</p>
	</div>
	<Button
		type="button"
		variant="outline"
		class="h-11 gap-2 px-4"
		disabled={disabled || uploading}
		onclick={onChoose}
	>
		<ImagePlusIcon class="size-4" />
		{m.media_picker_add_media()}
	</Button>
</div>
