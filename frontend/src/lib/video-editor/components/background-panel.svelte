<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { addBackgroundItem } from '$lib/video-editor/timeline/actions/backgrounds';
	import { BACKGROUND_PRESETS } from '$lib/video-editor/backgrounds/presets';

	let { oninserted }: { oninserted: (itemId: string) => void } = $props();

	function presetLabel(id: string): string {
		switch (id) {
			case 'mesh-sunset':
				return m.video_editor_background_preset_mesh_sunset();
			case 'mesh-ocean':
				return m.video_editor_background_preset_mesh_ocean();
			case 'mesh-forest':
				return m.video_editor_background_preset_mesh_forest();
			case 'mesh-neon':
				return m.video_editor_background_preset_mesh_neon();
			case 'pattern-dots':
				return m.video_editor_background_preset_pattern_dots();
			case 'pattern-grid':
				return m.video_editor_background_preset_pattern_grid();
			case 'pattern-stripes':
				return m.video_editor_background_preset_pattern_stripes();
			case 'pattern-checker':
				return m.video_editor_background_preset_pattern_checker();
			default:
				return id;
		}
	}
</script>

<div
	class="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
	aria-label={m.video_editor_backgrounds_title()}
>
	<p class="mb-2 text-xs leading-relaxed text-[oklch(0.64_0.015_55)]">
		{m.video_editor_backgrounds_hint()}
	</p>
	<div class="grid grid-cols-2 gap-1.5">
		{#each BACKGROUND_PRESETS as preset (preset.id)}
			<button
				type="button"
				class="group flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-[oklch(0.27_0.015_55)] bg-[oklch(0.18_0.01_55)] px-2 py-2 text-[11px] text-[oklch(0.72_0.01_55)] hover:border-[oklch(0.5_0.08_45)] hover:bg-[oklch(0.22_0.015_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				onclick={() => oninserted(addBackgroundItem(preset.id))}
				aria-label={presetLabel(preset.id)}
			>
				<span
					aria-hidden="true"
					class="h-10 w-full rounded-sm border border-white/10"
					style:background={preset.background.kind === 'mesh-gradient'
						? `linear-gradient(135deg, ${preset.background.colors[0]}, ${preset.background.colors[1]}, ${preset.background.colors[2]})`
						: preset.background.background}
				></span>
				<span>{presetLabel(preset.id)}</span>
			</button>
		{/each}
	</div>
</div>
