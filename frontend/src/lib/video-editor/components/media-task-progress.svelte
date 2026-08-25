<script lang="ts">
	import ChevronIcon from '@lucide/svelte/icons/chevron-right';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import XIcon from '@lucide/svelte/icons/x';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { mediaTasks, type MediaTask } from '$lib/video-editor/media/media-tasks.svelte';

	let expanded = $state(false);
	const tasks = $derived(mediaTasks.list);
	const averageProgress = $derived.by(() => {
		const determinate = tasks.filter((task) => task.progress !== null);
		if (determinate.length === 0) return null;
		return determinate.reduce((sum, task) => sum + (task.progress ?? 0), 0) / determinate.length;
	});

	function formatBytes(bytes: number): string {
		if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
	}

	function kindLabel(task: MediaTask): string {
		switch (task.kind) {
			case 'import':
				return m.video_editor_task_importing();
			case 'proxy':
				return m.video_editor_task_proxy();
			case 'filmstrip':
				return m.video_editor_task_filmstrip();
			case 'animated-image':
				return m.video_editor_task_animated_image();
			case 'waveform':
				return m.video_editor_task_waveform();
			case 'scene-analysis':
				return m.video_editor_task_scene_analysis();
			case 'transcription':
				return m.video_editor_task_transcription();
			case 'voice-generation':
				return m.video_editor_task_voice_generation();
			case 'music-generation':
				return m.video_editor_local_music();
			case 'reverse-conform':
				return m.video_editor_task_reverse_conform();
			case 'upscale':
				return m.video_editor_task_upscale();
			case 'frame-interpolation':
				return m.video_editor_task_interpolation();
		}
	}

	function stageLabel(task: MediaTask): string {
		if (task.status === 'cancelling' || task.stage === 'cancelling') {
			return m.video_editor_task_cancelling();
		}
		if (task.status === 'queued') return m.video_editor_task_queued();
		switch (task.stage) {
			case 'reading':
				return m.video_editor_task_reading();
			case 'probing':
				return m.video_editor_task_probing();
			case 'copying':
				return m.video_editor_task_copying();
			case 'saving':
				return m.video_editor_task_saving();
			case 'encoding':
				return m.video_editor_task_encoding();
			case 'extracting':
				return m.video_editor_task_extracting();
			case 'decoding':
				return m.video_editor_task_decoding();
		}
		if (task.kind === 'scene-analysis') {
			switch (task.stage) {
				case 'detecting':
					return m.video_editor_task_detecting_scenes();
				case 'thumbnails':
					return m.video_editor_task_scene_thumbnails();
				case 'loading-models':
					return m.video_editor_task_loading_models();
				case 'captioning':
					return m.video_editor_task_captioning_scenes();
				case 'indexing':
					return m.video_editor_task_indexing_scenes();
			}
		}
		if (task.kind === 'transcription') {
			switch (task.stage) {
				case 'downloading':
					return m.video_editor_transcribe_downloading();
				case 'preparing':
					return m.video_editor_transcribe_preparing();
				case 'decoding':
					return m.video_editor_transcribe_decoding();
				case 'transcribing':
					return m.video_editor_transcribing();
			}
		}
		if (task.kind === 'voice-generation') {
			switch (task.stage) {
				case 'downloading':
					return m.video_editor_local_ai_downloading();
				case 'preparing':
					return m.video_editor_local_ai_preparing();
				case 'generating':
					return m.video_editor_local_ai_generating();
				case 'finalizing':
					return m.video_editor_local_ai_finalizing();
			}
		}
		if (task.kind === 'reverse-conform') {
			return task.stage === 'rendering'
				? m.video_editor_task_rendering_reverse()
				: m.video_editor_task_reverse_conform();
		}
		if (task.kind === 'upscale' || task.kind === 'frame-interpolation') {
			if (task.stage === 'downloading-model') {
				return m.video_editor_task_downloading_motion_model();
			}
			if (task.stage === 'preparing') return m.video_editor_task_preparing_video();
			if (task.stage === 'rendering') return kindLabel(task);
		}
		return kindLabel(task);
	}

	function taskMeta(task: MediaTask): string {
		if (task.receivedBytes != null && task.totalBytes) {
			return `${formatBytes(task.receivedBytes)} / ${formatBytes(task.totalBytes)}`;
		}
		if (task.completed != null && task.total) {
			return `${Math.min(task.completed, task.total)} / ${task.total}`;
		}
		if (task.progress !== null) {
			const percent = `${Math.round(task.progress * 100)}%`;
			if (task.etaSeconds != null && task.etaSeconds > 0) {
				const seconds = Math.max(1, Math.round(task.etaSeconds));
				return `${percent} · ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`}`;
			}
			return percent;
		}
		return m.video_editor_task_working();
	}

	function cancel(task: MediaTask): void {
		mediaTasks.cancel(task.id);
	}
</script>

{#if tasks.length > 0}
	<section
		class="shrink-0 border-t border-[oklch(0.25_0.012_55)] bg-[oklch(0.155_0.01_50)] px-2 py-2"
		aria-label={m.video_editor_background_tasks()}
		aria-live="polite"
	>
		<div class="flex items-center gap-2 text-[10px]">
			<LoaderIcon
				class="size-3.5 shrink-0 animate-spin text-[oklch(0.72_0.12_190)]"
				aria-hidden="true"
			/>
			<button
				type="button"
				class="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded text-left text-[oklch(0.72_0.012_55)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] sm:min-h-7"
				aria-expanded={expanded}
				onclick={() => (expanded = !expanded)}
			>
				<ChevronIcon
					class="size-3 shrink-0 transition-transform {expanded ? 'rotate-90' : ''}"
					aria-hidden="true"
				/>
				<span class="truncate">
					{tasks.length === 1
						? stageLabel(tasks[0]!)
						: m.video_editor_background_task_count({ count: tasks.length })}
				</span>
			</button>
			<span class="shrink-0 text-[oklch(0.66_0.012_55)] tabular-nums">
				{averageProgress === null
					? tasks.length === 1
						? taskMeta(tasks[0]!)
						: m.video_editor_task_working()
					: `${Math.round(averageProgress * 100)}%`}
			</span>
		</div>
		<div
			class="mt-1 h-1 overflow-hidden rounded-full bg-[oklch(0.25_0.012_55)]"
			role="progressbar"
			aria-label={m.video_editor_background_task_progress()}
			aria-valuemin={averageProgress === null ? undefined : 0}
			aria-valuemax={averageProgress === null ? undefined : 100}
			aria-valuenow={averageProgress === null ? undefined : Math.round(averageProgress * 100)}
		>
			<div
				class="h-full rounded-full bg-[oklch(0.69_0.13_190)] transition-[width] duration-300 {averageProgress ===
				null
					? 'w-1/3 animate-pulse'
					: ''}"
				style:width={averageProgress === null ? undefined : `${averageProgress * 100}%`}
			></div>
		</div>
		{#if expanded}
			<ul class="mt-2 space-y-1" aria-label={m.video_editor_background_task_details()}>
				{#each tasks as task (task.id)}
					<li class="flex min-w-0 items-center gap-2 rounded bg-white/5 px-1.5 py-1">
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[10px] text-[oklch(0.82_0.008_65)]">
								{task.label}
							</span>
							<span class="block truncate text-[9px] text-[oklch(0.58_0.012_55)]">
								{stageLabel(task)}
							</span>
						</span>
						<span class="shrink-0 text-[9px] text-[oklch(0.66_0.012_55)] tabular-nums">
							{taskMeta(task)}
						</span>
						{#if task.cancellable}
							<Button
								variant="ghost"
								size="icon-xs"
								class="size-11! shrink-0 sm:size-7!"
								disabled={task.status === 'cancelling'}
								aria-label={`${m.common_cancel()}: ${task.label}`}
								onclick={() => cancel(task)}
							>
								<XIcon class="size-3.5" aria-hidden="true" />
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
