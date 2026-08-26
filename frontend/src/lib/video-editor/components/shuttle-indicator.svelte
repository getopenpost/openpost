<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	let {
		active,
		playbackRate,
		class: className = ''
	}: { active: boolean; playbackRate: number; class?: string } = $props();

	const reverse = $derived(playbackRate < 0);
	const speed = $derived(Math.abs(playbackRate));
	const key = $derived(reverse ? 'J' : 'L');
	const direction = $derived(reverse ? '◀' : '▶');
	const label = $derived(
		reverse
			? m.video_editor_shuttle_reverse({ speed: String(speed) })
			: m.video_editor_shuttle_forward({ speed: String(speed) })
	);
</script>

{#if active && playbackRate !== 0}
	<output
		class={`inline-flex h-5 min-w-[3.75rem] shrink-0 items-center justify-center gap-1 rounded border px-1.5 font-mono text-[10px] font-semibold tabular-nums select-none ${speed > 1 ? 'border-[oklch(0.66_0.14_45)]/40 bg-[oklch(0.66_0.14_45)]/15 text-[oklch(0.66_0.14_45)]' : 'border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)] text-[oklch(0.68_0.015_55)]'} ${className}`}
		aria-label={label}
		title={label}
		data-testid="shuttle-indicator"
	>
		<span class="text-[9px] opacity-70">{key}</span>
		<span aria-hidden="true">{direction}</span>
		<span>{speed}×</span>
	</output>
{/if}
