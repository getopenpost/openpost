<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { repurposeAudioTrack, repurposeSourceKey } from '../repurpose-source';
	import type { RepurposeReviewContext } from '../repurpose-review.svelte';
	import TranscriptCutPanel from './TranscriptCutPanel.svelte';
	import RepurposeReviewPanel from './RepurposeReviewPanel.svelte';
	import type { QuickCutSource } from '../types';
	let {
		context,
		onsave,
		onback
	}: {
		context: RepurposeReviewContext;
		onsave: (sourceId: string, transcript: NonNullable<QuickCutSource['transcript']>) => void;
		onback: () => void;
	} = $props();
	const hasTranscript = $derived(
		context.source.transcript?.audioTrackIndex === repurposeAudioTrack(context.source) &&
			Boolean(context.source.transcript?.words.length)
	);
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
		<div>
			<h2 class="text-sm font-semibold">{m.repurpose_title()}</h2>
			<p class="text-xs text-muted-foreground">{m.repurpose_intro()}</p>
		</div>
		<Button variant="ghost" size="sm" onclick={onback}>{m.repurpose_back()}</Button>
	</div>
	{#if hasTranscript}
		{#key JSON.stringify( [context.actorId, context.workspaceId, context.projectId, context.storage, repurposeSourceKey(context.source)] )}
			<RepurposeReviewPanel {context} />
		{/key}
	{:else}
		<div class="mx-auto w-full max-w-xl space-y-4 p-4">
			<p class="text-sm">{m.repurpose_transcribe_hint()}</p>
			{#key JSON.stringify( [context.actorId, context.workspaceId, context.projectId, context.source.id, repurposeAudioTrack(context.source)] )}
				<TranscriptCutPanel
					source={context.source}
					segments={[]}
					currentTime={0}
					{onsave}
					onremove={() => {}}
					onseek={() => {}}
					workspaceId={context.storage === 'cloud' ? context.workspaceId : ''}
					transcriptionOnly
				/>
			{/key}
		</div>
	{/if}
</div>
