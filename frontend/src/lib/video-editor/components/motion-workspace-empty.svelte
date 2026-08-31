<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { CreateCompositeCompositionOptions } from '$lib/video-editor/sequences/sequence-actions';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
	import MotionCompositionDialog from './motion-composition-dialog.svelte';

	let {
		width,
		height,
		fps,
		defaultName,
		oncreate
	}: {
		width: number;
		height: number;
		fps: number;
		defaultName: string;
		oncreate: (options: CreateCompositeCompositionOptions) => void;
	} = $props();

	let dialogOpen = $state(false);
</script>

<section
	class="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-[oklch(0.205_0.008_55)] p-6"
	aria-label={m.video_editor_workspace_motion()}
	data-motion-preview-empty
>
	<div class="flex max-w-sm flex-col items-center text-center">
		<div
			class="mb-3 flex size-10 items-center justify-center rounded-lg border border-[oklch(0.31_0.018_55)] bg-[oklch(0.17_0.01_55)] text-[var(--video-editor-focus)] shadow-sm"
		>
			<WandSparklesIcon class="size-5" aria-hidden="true" />
		</div>
		<h2 class="text-sm font-semibold">{m.video_editor_motion_empty_title()}</h2>
		<p class="mt-1 max-w-xs text-xs leading-5 text-[var(--video-editor-muted)]">
			{m.video_editor_motion_empty_description()}
		</p>
		<Button class="mt-4 gap-1.5" size="sm" onclick={() => (dialogOpen = true)}>
			<PlusIcon class="size-3.5" aria-hidden="true" />
			{m.video_editor_motion_new_composition()}
		</Button>
	</div>
</section>

<MotionCompositionDialog
	bind:open={dialogOpen}
	defaultWidth={width}
	defaultHeight={height}
	defaultFps={fps}
	{defaultName}
	{oncreate}
/>
