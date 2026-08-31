<script lang="ts">
	import { m } from '$lib/paraglide/messages';
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
		oncreateadjustment
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		onselectitem?: (itemId: string) => void;
		oncreateadjustment?: () => void;
	} = $props();
</script>

<section
	class="flex size-full min-h-0 shrink-0 flex-col overflow-hidden border-t border-[oklch(0.25_0.015_55)] bg-[oklch(0.135_0.007_55)]"
	aria-label={m.video_editor_color_dock()}
>
	<ColorMiniTimeline selectedItemIds={itemIds} {onselectitem} />
	<div
		class="grid min-h-0 flex-1 grid-cols-1 gap-1.5 overflow-y-auto p-1.5 lg:grid-cols-[minmax(0,10fr)_minmax(0,3fr)_minmax(0,7fr)] lg:overflow-hidden"
		data-color-dock-panels
	>
		<div
			class="grid min-h-[520px] min-w-0 grid-cols-1 overflow-hidden border border-white/10 bg-[oklch(0.16_0.008_55)] lg:min-h-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.5fr)]"
		>
			<div class="min-h-0 min-w-0 overflow-hidden lg:border-r lg:border-white/10">
				<ColorWorkspace {itemId} {itemIds} {onedit} {oncreateadjustment} />
			</div>
			<div class="min-h-0 min-w-0 overflow-hidden border-t border-white/10 lg:border-t-0">
				<ColorCurvesPanel {itemId} {itemIds} {onedit} />
			</div>
		</div>
		<div
			class="flex min-h-[280px] min-w-0 flex-col overflow-hidden border border-white/10 bg-[oklch(0.16_0.008_55)] lg:min-h-0"
		>
			<h3
				class="flex h-8 shrink-0 items-center border-b border-white/10 bg-white/[0.025] px-2 text-xs font-medium text-white/90"
			>
				{m.video_editor_effects()}
			</h3>
			<div class="min-h-0 flex-1 overflow-y-auto">
				<EffectsPanel
					{itemId}
					{itemIds}
					{onedit}
					hiddenGpuEffectIds={['gpu-color-wheels', 'gpu-curves']}
				/>
			</div>
		</div>
		<div
			class="min-h-[300px] min-w-0 overflow-hidden border border-white/10 bg-[oklch(0.16_0.008_55)] lg:min-h-0"
		>
			<ColorKeyframePanel {itemId} {onedit} />
		</div>
	</div>
</section>
