<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import ColorMiniTimeline from './color-mini-timeline.svelte';
	import ColorCurvesPanel from './color-curves-panel.svelte';
	import ColorKeyframePanel from './color-keyframe-panel.svelte';
	import ColorWorkspace from './color-workspace.svelte';
	import EffectsPanel from './effects-panel.svelte';

	let {
		itemId,
		itemIds = [],
		onedit,
		onselectitem = () => undefined,
		oncreateadjustment,
		oncreatesequencegrade,
		onscopechange = () => undefined
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		onselectitem?: (itemId: string) => void;
		oncreateadjustment?: () => void;
		oncreatesequencegrade?: () => string | null;
		onscopechange?: (scope: 'clip' | 'sequence') => void;
	} = $props();
	let colorAutoKey = $state(false);
	let colorScope = $state<'clip' | 'sequence'>('clip');
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
		class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--video-editor-border)] px-2"
	>
		<span class="text-[10px] tracking-wide text-[var(--video-editor-muted)] uppercase">
			{m.video_editor_color_workspace()}
		</span>
		<div
			class="grid grid-cols-2 overflow-hidden rounded border border-[var(--video-editor-border)]"
			role="group"
			aria-label={`${m.video_editor_color_workspace()} ${m.video_editor_clip()}`}
		>
			<button
				type="button"
				class="h-7 px-3 text-[10px] [@media(pointer:coarse)]:h-11 {colorScope === 'clip'
					? 'bg-[var(--video-editor-primary)] text-[var(--video-editor-primary-text)]'
					: 'hover:bg-[var(--video-editor-control)]'}"
				aria-pressed={colorScope === 'clip'}
				onclick={() => setColorScope('clip')}
			>
				{m.video_editor_clip()}
			</button>
			<button
				type="button"
				class="h-7 border-l border-[var(--video-editor-border)] px-3 text-[10px] [@media(pointer:coarse)]:h-11 {colorScope ===
				'sequence'
					? 'bg-[var(--video-editor-primary)] text-[var(--video-editor-primary-text)]'
					: 'hover:bg-[var(--video-editor-control)]'}"
				aria-pressed={colorScope === 'sequence'}
				onclick={() => setColorScope('sequence')}
			>
				{m.video_editor_sequences()}
			</button>
		</div>
	</div>
	<ColorMiniTimeline selectedItemIds={scopedItemIds} {onselectitem} />
	{#key sequenceGradeItemId}
		{#if colorScope === 'sequence' && !sequenceGradeItemId}
			<div class="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
				<div class="max-w-72 space-y-3">
					<p class="text-xs text-[var(--video-editor-muted)]">
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
				class="grid min-h-0 flex-1 grid-cols-1 gap-1.5 overflow-y-auto p-1.5 lg:grid-cols-[minmax(0,10fr)_minmax(0,3fr)_minmax(0,7fr)] lg:overflow-hidden"
				data-color-dock-panels
			>
				<div
					class="grid min-h-[520px] min-w-0 grid-cols-1 overflow-hidden border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] lg:min-h-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.5fr)]"
				>
					<div
						class="min-h-0 min-w-0 overflow-hidden lg:border-r lg:border-[var(--video-editor-border)]"
					>
						<ColorWorkspace
							itemId={scopedItemId}
							itemIds={scopedItemIds}
							{onedit}
							{oncreateadjustment}
							autoKey={colorAutoKey}
							onAutoKeyChange={(enabled) => (colorAutoKey = enabled)}
						/>
					</div>
					<div
						class="min-h-0 min-w-0 overflow-hidden border-t border-[var(--video-editor-border)] lg:border-t-0"
					>
						<ColorCurvesPanel
							itemId={scopedItemId}
							itemIds={scopedItemIds}
							{onedit}
							forceAutoKey={colorAutoKey}
						/>
					</div>
				</div>
				<div
					class="flex min-h-[280px] min-w-0 flex-col overflow-hidden border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] lg:min-h-0"
				>
					<h3
						class="flex h-8 shrink-0 items-center border-b border-[var(--video-editor-border)] bg-[var(--video-editor-control)] px-2 text-xs font-medium text-[var(--video-editor-text)]"
					>
						{m.video_editor_effects()}
					</h3>
					<div class="min-h-0 flex-1 overflow-y-auto">
						<EffectsPanel
							itemId={scopedItemId}
							itemIds={scopedItemIds}
							{onedit}
							gpuOnly={colorScope === 'sequence'}
							hiddenGpuEffectIds={['gpu-color-wheels', 'gpu-curves']}
						/>
					</div>
				</div>
				<div
					class="min-h-[300px] min-w-0 overflow-hidden border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] lg:min-h-0"
				>
					<ColorKeyframePanel itemId={scopedItemId} {onedit} />
				</div>
			</div>
		{/if}
	{/key}
</section>

<style>
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
</style>
