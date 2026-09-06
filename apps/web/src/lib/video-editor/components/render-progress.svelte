<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { cn } from '$lib/utils';
	import type { RenderExportProgress } from '../media/render-export';

	interface Props {
		progress: RenderExportProgress;
		startedAt?: number;
		clock?: () => number;
		class?: string;
	}

	let { progress, startedAt, clock = Date.now, class: className }: Props = $props();
	let now = $state(0);

	const percent = $derived(Math.max(0, Math.min(100, Math.round(progress.progress * 100))));
	const elapsedSeconds = $derived(
		startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
	);

	function phaseLabel(phase: RenderExportProgress['phase']): string {
		switch (phase) {
			case 'preparing':
				return m.video_editor_export_phase_preparing();
			case 'mixing':
				return m.video_editor_export_phase_mixing();
			case 'rendering':
				return m.video_editor_export_phase_rendering();
			case 'encoding':
				return m.video_editor_export_phase_encoding();
			case 'finalizing':
				return m.video_editor_export_phase_finalizing();
		}
	}

	function formatElapsed(seconds: number): string {
		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const remainder = seconds % 60;
		return hours > 0
			? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
			: `${minutes}:${String(remainder).padStart(2, '0')}`;
	}

	$effect(() => {
		now = clock();
		if (startedAt === undefined) return;
		const timer = window.setInterval(() => {
			now = clock();
		}, 1_000);
		return () => window.clearInterval(timer);
	});
</script>

<div class={cn('space-y-1.5', className)} data-testid="render-progress">
	<div class="flex min-w-0 items-center justify-between gap-2 text-xs">
		<span
			class="min-w-0 truncate text-[var(--video-editor-muted)]"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			{phaseLabel(progress.phase)}
		</span>
		<span class="shrink-0 font-medium tabular-nums">{percent}%</span>
	</div>
	<div
		class="h-1.5 overflow-hidden rounded-full bg-[var(--video-editor-canvas)]"
		role="progressbar"
		aria-label={m.video_editor_export_progress_label()}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={percent}
	>
		<div
			class="h-full bg-[var(--video-editor-focus)] transition-[width] duration-150 motion-reduce:transition-none"
			style={`width: ${percent}%`}
		></div>
	</div>
	<div
		class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-[var(--video-editor-muted)] tabular-nums"
	>
		{#if progress.phase === 'rendering' && progress.totalFrames > 0}
			<span>
				{m.video_editor_export_progress_frames({
					done: progress.framesDone,
					total: progress.totalFrames
				})}
			</span>
		{/if}
		{#if startedAt !== undefined}
			<span class="ml-auto">
				{m.video_editor_export_progress_elapsed({ time: formatElapsed(elapsedSeconds) })}
			</span>
		{/if}
	</div>
</div>
