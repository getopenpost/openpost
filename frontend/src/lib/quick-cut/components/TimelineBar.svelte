<script lang="ts">
	import type { QuickCutSegment } from '../types';
	import { m } from '$lib/paraglide/messages';

	let {
		duration,
		segments,
		currentTime,
		selectedId,
		inPoint,
		outPoint,
		onSeek,
		onSelect
	}: {
		duration: number;
		segments: QuickCutSegment[];
		currentTime: number;
		selectedId: string | null;
		inPoint: number | null;
		outPoint: number | null;
		onSeek: (t: number) => void;
		onSelect: (id: string) => void;
	} = $props();

	function pct(t: number): number {
		if (duration <= 0) return 0;
		return Math.max(0, Math.min(100, (t / duration) * 100));
	}
</script>

<div class="space-y-2">
	<div
		class="relative h-14 w-full overflow-hidden rounded-xl border bg-card shadow-inner"
		role="group"
		aria-label={m.quick_cut_timeline_label()}
	>
		<button
			type="button"
			class="absolute inset-0"
			aria-label={m.quick_cut_seek_timeline()}
			onclick={(e) => {
				const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
				const x = e.clientX - rect.left;
				onSeek((x / rect.width) * duration);
			}}
		></button>

		{#each segments as seg (seg.id)}
			<button
				type="button"
				class="absolute top-2 bottom-2 rounded-md border text-left transition {selectedId === seg.id
					? 'border-primary bg-primary/20 shadow'
					: 'border-primary/30 bg-primary/10 hover:bg-primary/15'}"
				style={`left:${pct(seg.start)}%; width:${Math.max(1, pct(seg.end) - pct(seg.start))}%`}
				aria-label={`${m.quick_cut_segment()} ${seg.start.toFixed(1)}-${seg.end.toFixed(1)}`}
				onclick={() => onSelect(seg.id)}
			></button>
		{/each}

		{#if inPoint !== null}
			<div class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-amber-500" style={`left:${pct(inPoint)}%`}></div>
		{/if}
		{#if outPoint !== null}
			<div class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-emerald-500" style={`left:${pct(outPoint)}%`}></div>
		{/if}

		<div class="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-foreground shadow" style={`left:${pct(currentTime)}%`}>
			<div class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-foreground"></div>
		</div>
	</div>
	<div class="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
		<span>0:00</span>
		<span>{Math.floor(duration / 60)}:{(duration % 60).toFixed(1).padStart(4, '0')}</span>
	</div>
</div>
