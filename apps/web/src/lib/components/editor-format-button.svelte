<script lang="ts">
	import { ProtectedIcon } from '$lib/themes/icons';
	let {
		label,
		width,
		height,
		disabled = false,
		busy = false,
		onclick
	}: {
		label: string;
		width: number;
		height: number;
		disabled?: boolean;
		busy?: boolean;
		onclick: () => void;
	} = $props();
</script>

<button
	type="button"
	{onclick}
	{disabled}
	class="flex min-h-24 min-w-0 items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
>
	<span
		class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted p-2"
		aria-hidden="true"
	>
		<span
			class="max-h-full max-w-full rounded-xs border border-foreground/30 bg-background"
			style:aspect-ratio={`${width}/${height}`}
			style:height={height > width ? '100%' : 'auto'}
			style:width={width >= height ? '100%' : 'auto'}
		></span>
	</span>
	<span class="min-w-0 flex-1"
		><span class="block text-sm font-medium">{label}</span><span
			class="mt-1 block text-xs text-muted-foreground">{width} × {height}</span
		></span
	>
	{#if busy}<ProtectedIcon
			icon="loading"
			class="size-4 shrink-0 animate-spin motion-reduce:animate-none"
		/>{/if}
</button>
