<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import type { AiCaptionJobStatus } from '$lib/video-editor/transcript/ai-caption-service.svelte';

	let {
		canGenerate,
		busy,
		status,
		queuePosition,
		queueTotal,
		progress,
		error,
		onstart,
		oncancel
	}: {
		canGenerate: boolean;
		busy: boolean;
		status?: AiCaptionJobStatus;
		queuePosition?: number | null;
		queueTotal?: number;
		progress: { stage: string; percent: number; completed?: number; total?: number } | null;
		error?: string | null;
		onstart: () => void;
		oncancel: () => void;
	} = $props();

	function stageLabel(value: { stage: string; percent: number }): string {
		if (value.stage === 'detecting') return m.video_editor_task_captioning_scenes();
		if (value.stage === 'thumbnails') return m.video_editor_task_captioning_scenes();
		if (value.stage === 'loading-models' || value.stage === 'loading-model')
			return m.video_editor_transcribe_preparing();
		if (value.stage === 'captioning') return m.video_editor_task_captioning_scenes();
		if (value.stage === 'indexing') return m.video_editor_task_captioning_scenes();
		if (value.stage === 'cancelling') return m.video_editor_transcribe_cancel();
		return m.video_editor_ai_captions_generating();
	}
</script>

<div
	class="grid w-full max-w-full gap-1 overflow-hidden rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] p-1.5"
	data-testid="ai-caption-controls"
>
	<div class="flex items-center justify-between gap-2">
		<p class="text-[11px] font-medium text-[var(--video-editor-text)]">
			{m.video_editor_ai_captions()}
		</p>
		<span class="text-[10px] text-[var(--video-editor-muted)]"
			>{m.video_editor_ai_captions_hint()}</span
		>
	</div>
	<p class="text-[10px] leading-tight text-[var(--video-editor-muted)]">
		{m.video_editor_ai_captions_description()}
	</p>
	{#if error}
		<p
			class="rounded bg-[var(--video-editor-panel)] px-1.5 py-1 text-[10px] text-[var(--video-editor-danger)]"
			role="alert"
		>
			{error}
		</p>
	{/if}
	{#if busy && status === 'queued'}
		<p
			class="rounded bg-[var(--video-editor-panel)] px-1.5 py-1 text-[10px] text-[var(--video-editor-muted)]"
			role="status"
		>
			{m.video_editor_transcribe_queued({
				position: queuePosition ?? 1,
				total: Math.max(queueTotal ?? 1, queuePosition ?? 1)
			})}
		</p>
	{/if}
	{#if busy && progress}
		<div class="col-span-2" aria-live="polite">
			<div
				class="mb-0.5 flex items-center justify-between text-[9px] text-[var(--video-editor-muted)]"
			>
				<span>{stageLabel(progress)}</span>
				<span>{Math.round(progress.percent)}%</span>
			</div>
			<div
				class="h-1 overflow-hidden rounded-full bg-[var(--video-editor-panel)]"
				role="progressbar"
				aria-label={stageLabel(progress)}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(progress.percent)}
			>
				<div
					class="h-full rounded-full bg-[var(--video-editor-focus)] transition-[width]"
					style:width={`${Math.max(2, progress.percent)}%`}
				></div>
			</div>
		</div>
	{/if}
	<Button
		size="sm"
		class="min-h-11 w-full"
		variant={busy ? 'outline' : 'secondary'}
		disabled={!canGenerate && !busy}
		aria-label={busy ? m.video_editor_transcribe_cancel() : m.video_editor_ai_captions_action()}
		onclick={busy ? oncancel : onstart}
	>
		{busy ? m.video_editor_transcribe_cancel() : m.video_editor_ai_captions_action()}
	</Button>
</div>
