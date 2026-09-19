<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import ColorMiniTimeline from './color-mini-timeline.svelte';
	import ColorCurvesPanel from './color-curves-panel.svelte';
	import ColorKeyframePanel from './color-keyframe-panel.svelte';
	import ColorPaletteTabs, { type ColorPaletteOption } from './color-palette-tabs.svelte';
	import ColorWorkspace from './color-workspace.svelte';
	import EffectsPanel from './effects-panel.svelte';

	type ColorPalette = 'primaries' | 'curves' | 'effects' | 'keyframes';
	type EffectsPalette = 'all' | 'qualifier' | 'windows' | 'lut';

	let {
		itemId,
		itemIds = [],
		onedit,
		onselectitem = () => undefined,
		oncreateadjustment,
		oncreatesequencegrade,
		onscopechange = () => undefined,
		scopesVisible = true,
		ontogglescopes = () => undefined
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		onselectitem?: (itemId: string) => void;
		oncreateadjustment?: () => void;
		oncreatesequencegrade?: () => string | null;
		onscopechange?: (scope: 'clip' | 'sequence') => void;
		scopesVisible?: boolean;
		ontogglescopes?: () => void;
	} = $props();
	let colorAutoKey = $state(false);
	let colorScope = $state<'clip' | 'sequence'>('clip');
	let activePalette = $state<ColorPalette>('primaries');
	let activeEffectsPalette = $state<EffectsPalette>('all');
	let sequenceGradeItemId = $derived<string | null>(
		timelineStore.items.find((item) => item.type === 'adjustment' && item.sequenceColorGrade)?.id ??
			null
	);
	const clipItemIds = $derived(itemIds.length > 0 ? itemIds : itemId ? [itemId] : []);
	const scopedItemIds = $derived(
		colorScope === 'sequence' ? (sequenceGradeItemId ? [sequenceGradeItemId] : []) : clipItemIds
	);
	const scopedItemId = $derived(
		colorScope === 'sequence'
			? sequenceGradeItemId
			: itemId && clipItemIds.includes(itemId)
				? itemId
				: (clipItemIds[0] ?? null)
	);
	const targetLabel = $derived.by(() => {
		if (colorScope === 'sequence') return m.video_editor_sequences();
		if (scopedItemIds.length > 1) {
			return m.video_editor_items_selected({ count: scopedItemIds.length });
		}
		return (
			(scopedItemId && timelineStore.itemById.get(scopedItemId)?.label) ||
			m.video_editor_select_clip()
		);
	});
	const palettes = $derived<readonly ColorPaletteOption<ColorPalette>[]>([
		{ id: 'primaries', label: m.video_editor_color_primaries() },
		{ id: 'curves', label: m['video_editor_gpu_effect_gpu-curves']() },
		{ id: 'effects', label: m.video_editor_effects() },
		{ id: 'keyframes', label: m.video_editor_keyframes() }
	]);
	const effectsPalettes = $derived<readonly ColorPaletteOption<EffectsPalette>[]>([
		{ id: 'all', label: m.common_all() },
		{ id: 'qualifier', label: m['video_editor_gpu_effect_gpu-secondary-qualifier']() },
		{ id: 'windows', label: m['video_editor_gpu_effect_gpu-power-window']() },
		{ id: 'lut', label: m['video_editor_gpu_effect_gpu-lut']() }
	]);
	const visibleEffectIds = $derived.by((): readonly string[] | undefined => {
		if (activeEffectsPalette === 'qualifier') return ['gpu-secondary-qualifier'];
		if (activeEffectsPalette === 'windows') return ['gpu-power-window'];
		if (activeEffectsPalette === 'lut') return ['gpu-lut'];
		return undefined;
	});

	function setColorScope(next: 'clip' | 'sequence'): void {
		colorScope = next;
		onscopechange(next);
	}

	function createSequenceGrade(): void {
		sequenceGradeItemId = oncreatesequencegrade?.() ?? null;
	}
</script>

<section
	class="flex size-full min-h-0 shrink-0 flex-col overflow-hidden border-t border-[var(--video-editor-border)] bg-[var(--video-editor-panel)]"
	aria-label={m.video_editor_color_dock()}
	data-sequence-grade-item-id={sequenceGradeItemId ?? undefined}
>
	<div
		class="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--video-editor-border)] px-2 [@media(pointer:coarse)]:h-11"
	>
		<div class="flex min-w-28 shrink-0 items-center gap-1.5">
			<span class="text-[10px] text-[var(--video-editor-muted)]">{m.video_editor_color_dock()}</span
			>
			<span
				class="max-w-40 truncate text-[11px] font-medium"
				title={targetLabel}
				data-color-target-label>{targetLabel}</span
			>
		</div>
		<ColorPaletteTabs
			{palettes}
			active={activePalette}
			label={m.video_editor_color_workspace()}
			onselect={(palette) => (activePalette = palette)}
		/>
		<div class="ml-auto flex shrink-0 items-center gap-1">
			<button
				type="button"
				class="dock-tool"
				class:dock-tool-active={scopesVisible}
				aria-pressed={scopesVisible}
				onclick={ontogglescopes}
			>
				{m.video_editor_scopes()}
			</button>
			<div
				class="grid grid-cols-2 overflow-hidden rounded border border-[var(--video-editor-border)]"
				role="group"
				aria-label={m.video_editor_color_workspace()}
			>
				<button
					type="button"
					class="scope-button"
					class:scope-button-active={colorScope === 'clip'}
					aria-pressed={colorScope === 'clip'}
					onclick={() => setColorScope('clip')}
				>
					{m.video_editor_clip()}
				</button>
				<button
					type="button"
					class="scope-button border-l border-[var(--video-editor-border)]"
					class:scope-button-active={colorScope === 'sequence'}
					aria-pressed={colorScope === 'sequence'}
					onclick={() => setColorScope('sequence')}
				>
					{m.video_editor_sequences()}
				</button>
			</div>
		</div>
	</div>
	<ColorMiniTimeline compact selectedItemIds={scopedItemIds} {onselectitem} />
	{#key `${colorScope}:${scopedItemId ?? ''}`}
		{#if colorScope === 'sequence' && !sequenceGradeItemId}
			<div class="flex min-h-0 flex-1 items-center justify-center p-4 text-center">
				<div class="max-w-72 space-y-2">
					<p
						class="truncate text-[11px] text-[var(--video-editor-muted)]"
						title={m.video_editor_adjustment_layer_hint()}
					>
						{m.video_editor_adjustment_layer_hint()}
					</p>
					<button
						type="button"
						class="color-sequence-create [@media(pointer:coarse)]:min-h-11"
						onclick={createSequenceGrade}
					>
						<ProtectedIcon icon="editor-layers" class="size-3.5" />
						{m.video_editor_add_adjustment_layer()}
					</button>
				</div>
			</div>
		{:else}
			<div
				class="min-h-0 flex-1 overflow-hidden"
				role="tabpanel"
				aria-label={palettes.find((palette) => palette.id === activePalette)?.label}
				data-color-active-palette={activePalette}
			>
				<ColorWorkspace
					compact
					primaryActive={activePalette === 'primaries'}
					itemId={scopedItemId}
					itemIds={scopedItemIds}
					{onedit}
					{oncreateadjustment}
					autoKey={colorAutoKey}
					onAutoKeyChange={(enabled) => (colorAutoKey = enabled)}
				>
					{#if activePalette === 'curves'}
						<ColorCurvesPanel
							itemId={scopedItemId}
							itemIds={scopedItemIds}
							{onedit}
							forceAutoKey={colorAutoKey}
						/>
					{:else if activePalette === 'effects'}
						<div class="flex size-full min-h-0 flex-col">
							<div class="shrink-0 border-b border-[var(--video-editor-border)] px-2 py-1">
								<ColorPaletteTabs
									palettes={effectsPalettes}
									active={activeEffectsPalette}
									label={m.video_editor_effects()}
									onselect={(palette) => (activeEffectsPalette = palette)}
								/>
							</div>
							<div class="min-h-0 flex-1 overflow-hidden">
								<EffectsPanel
									itemId={scopedItemId}
									itemIds={scopedItemIds}
									{onedit}
									gpuOnly={colorScope === 'sequence'}
									hiddenGpuEffectIds={['gpu-color-wheels', 'gpu-curves']}
									visibleGpuEffectIds={visibleEffectIds}
								/>
							</div>
						</div>
					{:else if activePalette === 'keyframes'}
						<ColorKeyframePanel itemId={scopedItemId} {onedit} />
					{/if}
				</ColorWorkspace>
			</div>
		{/if}
	{/key}
</section>

<style>
	.dock-tool,
	.scope-button {
		height: 1.375rem;
		padding-inline: 0.625rem;
		font-size: 0.625rem;
		color: var(--video-editor-muted);
	}
	.dock-tool {
		border-radius: 0.25rem;
		border: 1px solid var(--video-editor-border);
	}
	.dock-tool:hover,
	.scope-button:hover {
		background: var(--video-editor-control-hover);
		color: var(--video-editor-text);
	}
	.dock-tool:focus-visible,
	.scope-button:focus-visible {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: -2px;
	}
	.dock-tool-active,
	.scope-button-active {
		background: var(--video-editor-selection);
		color: var(--video-editor-selection-text);
	}
	.color-sequence-create {
		display: inline-flex;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border-radius: 0.25rem;
		background: var(--video-editor-primary);
		padding-inline: 0.625rem;
		font-size: 0.6875rem;
		color: var(--video-editor-primary-text);
	}
	.color-sequence-create:focus-visible {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.dock-tool,
		.scope-button {
			height: 2.75rem;
			min-width: 2.75rem;
		}
	}
</style>
