<!--
	Composition timeline chrome: composition picker, timing fields, zoom and
	range actions, plus the generated-layer toolbar and layer filter.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import CompositionPicker from './composition-picker.svelte';
	import { Slider } from '$lib/components/ui/slider';
	import { ThemeIcon } from '$lib/themes/icons';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from '$lib/video-editor/timeline/zoom';

	type GeneratedLayerKind = 'text' | 'solid' | 'gradient' | 'shape' | 'controller';

	let {
		composition,
		compositions,
		fps,
		durationFrames,
		hasActiveRegion,
		filterText = $bindable(''),
		onswitch,
		onnewcomposition,
		ontimingchange,
		onfit,
		ontrimtoactive,
		onaddlayer
	}: {
		composition: { id: string; name: string; width: number; height: number };
		compositions: readonly { id: string; name: string }[];
		fps: number;
		durationFrames: number;
		hasActiveRegion: boolean;
		filterText?: string;
		onswitch: (compositionId: string) => void;
		onnewcomposition: () => void;
		ontimingchange: (
			patch: { fps?: number; durationInFrames?: number },
			commandType: string
		) => void;
		onfit: () => void;
		ontrimtoactive: () => void;
		onaddlayer: (kind: GeneratedLayerKind) => void;
	} = $props();

	const componentId = $props.id();
	const fpsHintId = `${componentId}-fps-hint`;
</script>

<div class="composition-header">
	<div class="header-left">
		<label class="header-label" for="composition-picker"
			>{m.video_editor_composition_timeline_picker()}</label
		>
		<CompositionPicker
			{compositions}
			value={composition.id}
			label={composition.name}
			triggerId="composition-picker"
			triggerClass="composition-picker"
			ariaLabel={m.video_editor_composition_timeline_picker()}
			testId="composition-picker"
			{onswitch}
		/>
		<Button
			size="sm"
			variant="ghost"
			aria-label={m.video_editor_motion_new_composition()}
			onclick={onnewcomposition}
			data-testid="composition-new"
		>
			<ThemeIcon role="add" class="size-4" />
			{m.video_editor_motion_new_composition()}
		</Button>
	</div>
	<div class="header-center">
		<span
			class="composition-meta"
			role="group"
			aria-label={m.video_editor_composition_timeline_meta()}
		>
			{composition.width}×{composition.height} ·
			<Input
				aria-label={m.video_editor_composition_timeline_fps()}
				aria-describedby={fpsHintId}
				class="meta-input"
				type="number"
				min="1"
				max="120"
				value={fps}
				onchange={(e) => {
					const v = Math.max(1, Math.min(120, Math.round(Number(e.currentTarget.value) || fps)));
					ontimingchange({ fps: v }, 'UPDATE_COMPOSITION_FPS');
				}}
				data-testid="composition-fps"
			/>
			{m.video_editor_composition_timeline_fps_suffix()} ·
			<Input
				aria-label={m.video_editor_composition_timeline_duration()}
				class="meta-input meta-input-duration"
				type="number"
				min="1"
				value={durationFrames}
				onchange={(e) => {
					const v = Math.max(1, Math.round(Number(e.currentTarget.value) || durationFrames));
					ontimingchange({ durationInFrames: v }, 'UPDATE_COMPOSITION_DURATION');
				}}
				data-testid="composition-duration"
			/>
			{m.video_editor_composition_timeline_frames()}
		</span>
	</div>
	<div class="header-right">
		<div class="header-zoom">
			<span class="zoom-label">{m.video_editor_composition_timeline_zoom()}</span>
			<div class="zoom-slider-wrap">
				<Slider
					value={timelineStore.zoomLevel}
					min={TIMELINE_ZOOM_MIN}
					max={TIMELINE_ZOOM_MAX}
					step={0.05}
					onValueChange={(value) => timelineStore._setZoomLevel(value)}
					ariaLabel={m.video_editor_composition_timeline_zoom()}
				/>
			</div>
			<Button
				size="sm"
				variant="ghost"
				aria-label={m.video_editor_composition_timeline_fit()}
				onclick={onfit}
				data-testid="composition-fit"
			>
				{m.video_editor_composition_timeline_fit()}
			</Button>
			{#if hasActiveRegion}
				<Button
					size="sm"
					variant="ghost"
					aria-label={m.video_editor_composition_timeline_trim_active()}
					onclick={ontrimtoactive}
					data-testid="composition-trim-active"
				>
					{m.video_editor_composition_timeline_trim_active()}
				</Button>
			{/if}
		</div>
	</div>
</div>
<p
	id={fpsHintId}
	class="border-b border-[var(--video-editor-border)] px-2 py-1 text-[11px] leading-4 text-[var(--video-editor-muted)]"
>
	{m.video_editor_composition_timeline_fps_hint()}
</p>
<!-- Generated layers + media add -->
<div
	class="composition-toolbar"
	role="toolbar"
	aria-label={m.video_editor_composition_timeline_toolbar()}
>
	<span class="toolbar-label">{m.video_editor_composition_timeline_add_layer()}</span>
	<Button
		size="sm"
		variant="outline"
		onclick={() => onaddlayer('text')}
		data-testid="add-layer-text">{m.video_editor_motion_add_text()}</Button
	>
	<Button
		size="sm"
		variant="outline"
		onclick={() => onaddlayer('solid')}
		data-testid="add-layer-solid">{m.video_editor_motion_add_solid()}</Button
	>
	<Button
		size="sm"
		variant="outline"
		onclick={() => onaddlayer('gradient')}
		data-testid="add-layer-gradient">{m.video_editor_motion_add_gradient()}</Button
	>
	<Button
		size="sm"
		variant="outline"
		onclick={() => onaddlayer('shape')}
		data-testid="add-layer-shape">{m.video_editor_motion_add_shape()}</Button
	>
	<Button
		size="sm"
		variant="outline"
		onclick={() => onaddlayer('controller')}
		data-testid="add-layer-controller">{m.video_editor_motion_add_controller()}</Button
	>
	<label class="toolbar-search">
		<span class="sr-only">{m.video_editor_composition_timeline_filter()}</span>
		<Input
			class="filter-input"
			placeholder={m.video_editor_composition_timeline_filter_placeholder()}
			value={filterText}
			oninput={(e) => (filterText = (e.currentTarget as HTMLInputElement).value)}
			aria-label={m.video_editor_composition_timeline_filter()}
			data-testid="composition-filter"
		/>
	</label>
</div>

<style>
	.composition-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--video-editor-border);
		background: var(--video-editor-panel);
	}
	.header-left,
	.header-center,
	.header-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.header-label {
		font-size: 0.62rem;
		color: var(--video-editor-muted);
	}
	.composition-header :global(.composition-picker) {
		min-width: 160px;
		height: 32px;
		border-radius: 0.32rem;
		border: 1px solid var(--video-editor-border);
		background: var(--video-editor-control);
		color: inherit;
		padding: 0 0.4rem;
		font-size: 0.72rem;
	}
	.composition-header :global(.composition-picker:focus-visible) {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: 2px;
	}
	.composition-meta {
		font-size: 0.62rem;
		color: var(--video-editor-muted);
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.composition-meta :global(.meta-input) {
		width: 56px;
		height: 24px;
		border-radius: 0.25rem;
		border: 1px solid var(--video-editor-border);
		background: var(--video-editor-control);
		color: inherit;
		text-align: center;
		font-size: 0.62rem;
	}
	.composition-meta :global(.meta-input-duration) {
		width: 72px;
	}
	.composition-meta :global(.meta-input:focus-visible) {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: 2px;
	}
	.header-zoom {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.zoom-label {
		font-size: 0.62rem;
		color: var(--video-editor-muted);
	}
	.zoom-slider-wrap {
		width: 140px;
	}
	.composition-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.7rem;
		border-bottom: 1px solid var(--video-editor-border);
		background: var(--video-editor-panel);
	}
	.toolbar-label {
		font-size: 0.62rem;
		color: var(--video-editor-muted);
		margin-right: 0.2rem;
	}
	.toolbar-search {
		margin-left: auto;
	}
	.toolbar-search :global(.filter-input) {
		box-sizing: border-box;
		width: 180px;
		height: 32px;
		border-radius: 0.32rem;
		border: 1px solid var(--video-editor-border);
		background: var(--video-editor-control);
		color: inherit;
		padding: 0 0.5rem;
		font-size: 0.72rem;
	}
	.toolbar-search :global(.filter-input:focus-visible) {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: 2px;
	}
	@media (max-width: 480px) {
		.composition-header,
		.composition-toolbar {
			padding-inline: 0.45rem;
		}
		.header-left,
		.header-center,
		.header-right,
		.toolbar-search {
			width: 100%;
		}
		.composition-header :global(.composition-picker),
		.toolbar-search :global(.filter-input) {
			min-width: 0;
			width: 100%;
		}
		.header-zoom {
			flex: 1;
			min-width: 0;
		}
		.zoom-slider-wrap {
			flex: 1;
			min-width: 96px;
			width: auto;
		}
	}
</style>
