<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import * as Select from '$lib/components/ui/select';
	import { recordingAnalysisItemIds } from '../transcript/recording-review';
	import { collectTranscriptSourceWords } from '../transcript/speech-cleanup';
	import { findLinkedAudioCompanion } from '../audio/transition-crossfade';
	import { mediaPool } from '../media/pool.svelte';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import { isTrackEffectivelyLocked } from '../timeline/utils/track-groups';
	import { transcriptionService } from '../transcript/transcription-service.svelte';
	import type { TranscriptionSelection } from '../transcript/engine/types';
	import { editorSession } from '../editor.svelte';
	import TranscriptionControls from './transcription-controls.svelte';

	let { itemIds, onready }: { itemIds: string[]; onready: () => void } = $props();
	let selectedId = $state('');
	let starting = $state(false);
	let error = $state('');
	const sources = $derived.by(() => {
		const ids = recordingAnalysisItemIds(timelineStore.items, itemIds);
		const owners = new Map(
			ids.flatMap((id) => {
				const item = timelineStore.itemById.get(id);
				if (!item) return [];
				const owner = findLinkedAudioCompanion(item, timelineStore.items) ?? item;
				return [[owner.id, owner] as const];
			})
		);
		return [...owners.values()].filter((item) => {
			const media = item.mediaId ? mediaPool.get(item.mediaId) : undefined;
			return (
				media &&
				media.hasAudio !== false &&
				media.audioCodecSupported !== false &&
				!item.audioDetached &&
				!isTrackEffectivelyLocked(item.trackId, timelineStore.tracks) &&
				collectTranscriptSourceWords(timelineStore.items, [item.id], timelineStore.fps).length === 0
			);
		});
	});

	const sourceId = $derived(
		sources.find((item) => item.id === selectedId)?.id ?? sources[0]?.id ?? ''
	);
	const job = $derived(transcriptionService.jobForItem(sourceId));
	const busy = $derived(starting || Boolean(job));

	async function start(selection: TranscriptionSelection): Promise<void> {
		const id = sourceId;
		if (!id || busy) return;
		starting = true;
		error = '';
		try {
			await transcriptionService.enqueue(id, selection);
			editorSession.scheduleAutosave();
			onready();
		} catch (cause) {
			if (!(cause instanceof Error && cause.name === 'AbortError'))
				error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			starting = false;
		}
	}
</script>

{#if sources.length > 0 || busy}
	<div class="space-y-2">
		<p class="text-xs text-muted-foreground">{m.recording_cleanup_without_transcript()}</p>
		{#if sources.length > 1}
			<Select.Root bind:value={selectedId} disabled={busy}>
				<Select.Trigger class="w-full" aria-label={m.video_editor_clip()}>
					{sources.find((item) => item.id === sourceId)?.label}
				</Select.Trigger>
				<Select.Content class="video-editor-theme">
					{#each sources as source (source.id)}
						<Select.Item value={source.id}>{source.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		<TranscriptionControls
			canTranscribe={Boolean(sourceId)}
			{busy}
			status={job?.status}
			progress={job?.progress ?? null}
			backend={job?.backend ?? null}
			fallback={job?.fallback ?? null}
			queuePosition={job ? transcriptionService.queuePosition(job.id) : null}
			queueTotal={transcriptionService.jobs.length}
			startLabel={m.recording_cleanup_add_captions()}
			error={error || transcriptionService.errorForItem(sourceId)}
			onstart={(selection) => void start(selection)}
			oncancel={() => transcriptionService.cancelForItem(sourceId)}
		/>
	</div>
{/if}
