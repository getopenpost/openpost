<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import FileAudioIcon from '@lucide/svelte/icons/file-audio';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ImageIcon from '@lucide/svelte/icons/image';
	import LinkIcon from '@lucide/svelte/icons/link-2';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import VideoIcon from '@lucide/svelte/icons/video';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import type { IconComponent } from '$lib/component-types';
	import type {
		PostBuilderCopy,
		PostBuilderSource,
		PostBuilderSourceKind
	} from '$lib/post-builder';

	interface Props {
		sources: PostBuilderSource[];
		copy: PostBuilderCopy;
		disabled?: boolean;
		onRemove?: (source: PostBuilderSource) => void;
	}

	let { sources, copy, disabled = false, onRemove }: Props = $props();

	function sourceIcon(kind: PostBuilderSourceKind): IconComponent {
		if (kind === 'link') return LinkIcon;
		if (kind === 'image') return ImageIcon;
		if (kind === 'video') return VideoIcon;
		if (kind === 'audio') return FileAudioIcon;
		if (kind === 'text' || kind === 'note') return FileTextIcon;
		return FileIcon;
	}
</script>

{#if sources.length > 0}
	<ul
		class="grid gap-2 sm:grid-cols-2"
		aria-label={copy.sourceMaterialLabel}
		data-testid="post-builder-sources"
	>
		{#each sources as source (source.id)}
			{@const SourceIcon = sourceIcon(source.kind)}
			{@const status = source.status ?? 'ready'}
			<li
				class={`flex min-w-0 items-center gap-2.5 rounded-md border bg-background/75 px-2.5 py-2 ${status === 'failed' ? 'border-destructive/35 bg-destructive/5' : ''}`}
			>
				<span
					class={`flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ${status === 'failed' ? 'bg-destructive/10 text-destructive' : ''}`}
					aria-hidden="true"
				>
					{#if status === 'processing'}
						<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
					{:else}
						<SourceIcon class="size-4" />
					{/if}
				</span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium">{source.label}</p>
					{#if source.error || source.detail}
						<p
							class="truncate text-xs text-muted-foreground"
							class:text-destructive={status === 'failed'}
						>
							{source.error || source.detail}
						</p>
					{/if}
				</div>
				{#if onRemove && source.removable !== false}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						class="-mr-1 shrink-0 text-muted-foreground"
						disabled={disabled || status === 'processing'}
						onclick={() => onRemove?.(source)}
						aria-label={`${copy.removeSource}: ${source.label}`}
					>
						<XIcon class="size-3.5" />
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
