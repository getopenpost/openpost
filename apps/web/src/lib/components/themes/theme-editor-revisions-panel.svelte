<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { ThemeRevisionItem } from './theme-editor-types';

	interface Props {
		revisions: ThemeRevisionItem[];
		onRestore: (revision: ThemeRevisionItem) => void;
	}

	let { revisions, onRestore }: Props = $props();
</script>

<div class="divide-y divide-border border-y border-border">
	{#each revisions as revision (revision.revision)}
		<div class="flex items-center justify-between gap-3 py-3">
			<div>
				<p class="text-sm font-medium">
					{revision.label}{#if revision.current}
						· {m.theme_editor_current()}{/if}
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{revision.publishedAt}{#if revision.publishedBy}
						· {revision.publishedBy}{/if}
				</p>
			</div>
			{#if !revision.current}
				<Button size="sm" intent="ordinary" onclick={() => onRestore(revision)}
					>{m.theme_editor_restore()}</Button
				>
			{/if}
		</div>
	{/each}
	{#if revisions.length === 0}
		<p class="py-4 text-sm text-muted-foreground">{m.theme_editor_no_revisions()}</p>
	{/if}
</div>
