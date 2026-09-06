<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { QuickCutExportProgress } from '../export';
	import { formatBytes } from '$lib/video/constraints';

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
		if (ms === null || ms <= 0) return '-';
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		return `${Math.floor(s / 60)}m ${s % 60}s`;
	}

	function phaseText(phase: QuickCutExportProgress['phase']): string {
		if (phase === 'preparing') return m.video_editor_export_phase_preparing();
		if (phase === 'copying') return m.video_editor_task_copying();
		if (phase === 'transcoding') return m.video_editor_export_phase_encoding();
		return m.video_editor_export_phase_finalizing();
	}
</script>

{#if isExporting && progress}
	<div class="rounded-xl border bg-card p-4 shadow-sm">
		<div class="flex items-center justify-between gap-2">
			<h3 class="text-sm font-semibold">{m.quick_cut_exporting()}</h3>
			<Button size="xs" variant="outline" onclick={cancel} class="min-h-11 md:min-h-7"
				>{m.common_cancel()}</Button
			>
		</div>
		<div class="mt-3 space-y-2">
			<div
				class="h-2 overflow-hidden rounded-full bg-muted"
				role="progressbar"
				aria-label={m.video_editor_export_progress_label()}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(progress.fraction * 100)}
			>
				<div
					class="h-full bg-primary transition-all"
					style={`width:${Math.round(progress.fraction * 100)}%`}
				></div>
			</div>
			<div
				class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground tabular-nums"
			>
				<span>{Math.round(progress.fraction * 100)}%</span>
				<span>{formatBytes(progress.bytesWritten)}</span>
				<span>{progress.segmentIndex}/{progress.totalSegments} {m.quick_cut_segments_label()}</span>
				<span>ETA {etaText(progress.etaMs)}</span>
				<span>{phaseText(progress.phase)}</span>
			</div>
		</div>
	</div>
{/if}
