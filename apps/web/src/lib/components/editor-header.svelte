<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		identity,
		workspaces,
		actions
	}: {
		identity: Snippet;
		workspaces: Snippet;
		actions: Snippet;
	} = $props();
</script>

<header class="editor-header">
	<div class="flex min-w-0 items-center gap-2">{@render identity()}</div>
	<div class="flex min-w-0 justify-center">{@render workspaces()}</div>
	<div class="flex min-w-0 items-center justify-end gap-1 text-xs text-muted-foreground">
		{@render actions()}
	</div>
</header>

<style>
	.editor-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		height: 56px;
		flex-shrink: 0;
		padding-inline: 8px;
		border-bottom: 1px solid var(--border);
		background: var(--card);
	}
	@media (min-width: 768px) {
		.editor-header {
			grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
			height: 48px;
			padding-inline: 12px;
		}
	}
	@media (pointer: coarse) {
		.editor-header :global(button),
		.editor-header :global(a),
		.editor-header :global(input) {
			min-height: 44px;
			min-width: 44px;
		}
		.editor-header {
			height: 56px;
		}
	}
</style>
