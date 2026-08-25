<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { QuickCutExportProgress } from '../export';

	let {
		progress,
		cancel,
		isExporting
	}: {
		progress: QuickCutExportProgress | null;
		cancel: () => void;
		isExporting: boolean;
	} = $props();

	function etaText(ms: number | null): string {
		if (ms === null || ms <= 0) return '—';
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		return `${Math.floor(s / 60)}m ${s % 60}s`;
	}
</script>

{#if isExporting && progress}
	<div class="rounded-xl border bg-card p-4 shadow-sm">
		<div class="flex items-center justify-between gap-2">
			<h3 class="text-sm font-semibold">{m.quick_cut_exporting()}</h3>
			<Button size="xs" variant="outline" onclick={cancel} class="min-h-11 md:min-h-7">{m.common_cancel()}</Button>
		</div>
		<div class="mt-3 space-y-2">
			<div class="h-2 overflow-hidden rounded-full bg-muted">
				<div class="h-full bg-primary transition-all" style={`width:${Math.round(progress.fraction * 100)}%`}></div>
			</div>
			<div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums text-muted-foreground">
				<span>{Math.round(progress.fraction * 100)}%</span>
				<span>{progress.bytesWritten} bytes</span>
				<span>{progress.segmentIndex}/{progress.totalSegments} {m.quick_cut_segments_label()}</span>
				<span>ETA {etaText(progress.etaMs)}</span>
				<span>{progress.phase}</span>
			</div>
		</div>
	</div>
{/if}
