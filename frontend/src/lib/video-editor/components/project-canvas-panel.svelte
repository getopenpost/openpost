<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import {
		resetProjectCanvasDimensions,
		swapProjectCanvasDimensions,
		updateProjectCanvas
	} from '$lib/video-editor/project/canvas-settings';
	import { updateCompositeCompositionCanvas } from '$lib/video-editor/sequences/sequence-actions';
	import {
		MAX_PROJECT_HEIGHT,
		MAX_PROJECT_WIDTH,
		MIN_PROJECT_HEIGHT,
		MIN_PROJECT_WIDTH
	} from '$lib/video-editor/project/project-presets';
	import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';

	let { onedit }: { onedit: () => void } = $props();

	const activeComposite = $derived(
		sequenceStore.activeSequence?.editorKind === 'composite-2d'
			? sequenceStore.activeSequence
			: undefined
	);
	const metadata = $derived(
		editorSession.project ? (activeComposite ?? sequenceStore.rootResolution) : null
	);
	const minimumWidth = $derived(activeComposite ? 1 : MIN_PROJECT_WIDTH);
	const minimumHeight = $derived(activeComposite ? 1 : MIN_PROJECT_HEIGHT);
	let widthDraft = $state<number | string>(1920);
	let heightDraft = $state<number | string>(1080);
	let backgroundDraft = $state('#000000');

	$effect(() => {
		if (!metadata) return;
		widthDraft = metadata.width;
		heightDraft = metadata.height;
		backgroundDraft = metadata.backgroundColor ?? '#000000';
	});

	function commitDimension(dimension: 'width' | 'height', input: HTMLInputElement): void {
		if (!metadata) return;
		const value = Number(input.value);
		const changed = activeComposite
			? updateCompositeCompositionCanvas(activeComposite.id, { [dimension]: value })
			: updateProjectCanvas({ [dimension]: value });
		if (changed) onedit();
		else {
			input.value = String(metadata[dimension]);
			if (dimension === 'width') widthDraft = metadata.width;
			else heightDraft = metadata.height;
		}
	}

	function commitBackground(color: string): void {
		if (
			!metadata ||
			color.toLowerCase() === (metadata.backgroundColor ?? '#000000').toLowerCase()
		) {
			backgroundDraft = metadata?.backgroundColor ?? '#000000';
			return;
		}
		const changed = activeComposite
			? updateCompositeCompositionCanvas(activeComposite.id, { backgroundColor: color })
			: updateProjectCanvas({ backgroundColor: color });
		if (changed) onedit();
		else backgroundDraft = metadata.backgroundColor ?? '#000000';
	}

	function swapDimensions(): void {
		const changed = activeComposite
			? updateCompositeCompositionCanvas(activeComposite.id, {
					width: activeComposite.height,
					height: activeComposite.width
				})
			: swapProjectCanvasDimensions();
		if (!changed) return;
		onedit();
	}

	function resetDimensions(): void {
		const changed = activeComposite
			? updateCompositeCompositionCanvas(activeComposite.id, {
					width: sequenceStore.rootResolution.width,
					height: sequenceStore.rootResolution.height
				})
			: resetProjectCanvasDimensions();
		if (!changed) return;
		onedit();
	}

	function resetBackground(): void {
		commitBackground(
			activeComposite ? (sequenceStore.rootResolution.backgroundColor ?? '#000000') : '#000000'
		);
	}
</script>

{#if metadata}
	<section aria-labelledby="project-canvas-title" class="space-y-4">
		<div>
			<h2 id="project-canvas-title" class="text-sm font-semibold">
				{activeComposite
					? m.video_editor_motion_canvas_settings()
					: m.video_editor_project_canvas_settings()}
			</h2>
			<p class="mt-1 text-xs leading-relaxed text-[oklch(0.65_0.015_55)]">
				{activeComposite
					? m.video_editor_motion_canvas_settings_hint()
					: m.video_editor_project_canvas_settings_hint()}
			</p>
		</div>

		<div class="rounded-lg border border-[oklch(0.28_0.014_55)] bg-[oklch(0.17_0.01_55)] p-3">
			<div class="mb-2 flex items-center justify-between gap-2">
				<h3 class="text-xs font-medium">{m.video_editor_project_canvas_dimensions()}</h3>
				<span class="font-mono text-[10px] text-[oklch(0.65_0.015_55)]">{metadata.fps} fps</span>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<label class="grid gap-1 text-xs">
					<span>{m.video_editor_project_width()}</span>
					<Input
						type="number"
						bind:value={widthDraft}
						min={minimumWidth}
						max={MAX_PROJECT_WIDTH}
						step="1"
						onchange={(event) => commitDimension('width', event.currentTarget)}
					/>
				</label>
				<label class="grid gap-1 text-xs">
					<span>{m.video_editor_project_height()}</span>
					<Input
						type="number"
						bind:value={heightDraft}
						min={minimumHeight}
						max={MAX_PROJECT_HEIGHT}
						step="1"
						onchange={(event) => commitDimension('height', event.currentTarget)}
					/>
				</label>
			</div>
			<p class="mt-1.5 text-[10px] text-[oklch(0.6_0.012_65)]">
				{activeComposite
					? m.video_editor_motion_canvas_limits()
					: m.video_editor_project_canvas_limits()}
			</p>
			<div class="mt-3 grid grid-cols-2 gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="min-h-11 lg:min-h-8"
					onclick={swapDimensions}
				>
					<ArrowLeftRightIcon class="size-3.5" aria-hidden="true" />
					{m.video_editor_project_canvas_swap()}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="min-h-11 lg:min-h-8"
					onclick={resetDimensions}
				>
					<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					{activeComposite
						? m.video_editor_motion_canvas_reset()
						: m.video_editor_project_canvas_reset()}
				</Button>
			</div>
		</div>

		<div class="rounded-lg border border-[oklch(0.28_0.014_55)] bg-[oklch(0.17_0.01_55)] p-3">
			<h3 class="mb-2 text-xs font-medium">{m.video_editor_project_canvas_background()}</h3>
			<div class="flex items-center gap-2">
				<Input
					type="color"
					class="size-11 shrink-0 cursor-pointer p-1 lg:size-9"
					bind:value={backgroundDraft}
					aria-label={m.video_editor_project_canvas_background_color()}
					onchange={(event) => commitBackground(event.currentTarget.value)}
				/>
				<Input
					type="text"
					class="min-w-0 flex-1 font-mono uppercase"
					bind:value={backgroundDraft}
					pattern="#[0-9a-fA-F]{6}"
					maxlength={7}
					aria-label={m.video_editor_project_canvas_background_hex()}
					onblur={(event) => {
						const value = event.currentTarget.value;
						if (/^#[0-9a-f]{6}$/i.test(value)) commitBackground(value);
						else backgroundDraft = metadata.backgroundColor ?? '#000000';
					}}
					onkeydown={(event) => {
						if (event.key === 'Enter') event.currentTarget.blur();
						if (event.key === 'Escape') {
							backgroundDraft = metadata.backgroundColor ?? '#000000';
							event.currentTarget.blur();
						}
					}}
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="shrink-0"
					aria-label={m.video_editor_project_canvas_background_reset()}
					title={m.video_editor_project_canvas_background_reset()}
					onclick={resetBackground}
				>
					<RotateCcwIcon class="size-3.5" aria-hidden="true" />
				</Button>
			</div>
		</div>
	</section>
{/if}
