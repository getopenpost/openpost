<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import SegmentTimeInput from './SegmentTimeInput.svelte';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { m } from '$lib/paraglide/messages';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent
	} from '$lib/query/authorization-boundary';
	import { createRepurposeReview, type RepurposeReviewContext } from '../repurpose-review.svelte';
	import { prepareRepurposePreview } from '../repurpose-preview';
	let { context }: { context: RepurposeReviewContext } = $props();
	const review = createRepurposeReview(() => context);
	let topic = $state('');
	let activeId = $state('');
	let preview = $state<Awaited<ReturnType<typeof prepareRepurposePreview>> | null>(null);
	let previewBusy = $state(false);
	let previewProgress = $state(0);
	let previewError = $state('');
	let video = $state<HTMLVideoElement>();
	let audio = $state<HTMLAudioElement>();
	let sourceTime = $state(0);
	let previewRequest: AbortController | null = null;
	const active = $derived(
		review.candidates.find((candidate) => candidate.id === activeId) ?? review.candidates[0]
	);
	const words = $derived(review.snapshot?.words ?? []);
	const activePreviewKey = $derived(
		active ? `${review.snapshot?.revision}:${active.id}:${active.start}:${active.end}` : ''
	);
	const pendingCount = $derived(
		review.candidates.filter(
			(candidate) =>
				candidate.selected && !review.created.some((item) => item.candidateId === candidate.id)
		).length
	);
	const locked = $derived(review.busy || review.creating);
	const activeCreated = $derived(review.created.some((item) => item.candidateId === active?.id));
	function disposePreview() {
		previewRequest?.abort();
		previewRequest = null;
		void preview?.dispose();
		preview = null;
		previewBusy = false;
		previewError = '';
		sourceTime = 0;
	}
	$effect(() => {
		void activePreviewKey;
		untrack(disposePreview);
	});
	onMount(() => {
		void review.restore();
	});
	onDestroy(() => {
		review.dispose();
		disposePreview();
	});
	async function preparePreview() {
		if (!active || !review.snapshot) return;
		disposePreview();
		const request = new AbortController();
		previewRequest = request;
		const session = captureQueryMutationSession();
		previewBusy = true;
		previewProgress = 0;
		try {
			const prepared = await prepareRepurposePreview(
				context.source,
				active,
				review.snapshot.audio_track_index,
				request.signal,
				(progress) => {
					if (!request.signal.aborted) previewProgress = progress.fraction;
				}
			);
			if (request.signal.aborted || !queryMutationSessionIsCurrent(session)) {
				await prepared.dispose();
				return;
			}
			preview = prepared;
		} catch (cause) {
			if (!request.signal.aborted)
				previewError = cause instanceof Error ? cause.message : m.repurpose_preview_failed();
		} finally {
			if (previewRequest === request) {
				previewRequest = null;
				previewBusy = false;
			}
		}
	}
	function seek(time: number) {
		const player = video ?? audio;
		if (!player || !active) return;
		player.currentTime = Math.max(0, Math.min(active.end - active.start, time - active.start));
	}
	function time(value: number) {
		return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, '0')}`;
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-4">
	<div class="flex flex-wrap items-center gap-2">
		<Button disabled={locked} onclick={() => review.find(topic)}
			>{review.result ? m.repurpose_find_again() : m.repurpose_find()}</Button
		>
		{#if review.busy}<span class="text-sm text-muted-foreground" role="status"
				>{m.repurpose_finding()}</span
			><Button variant="outline" onclick={() => review.cancel()}>{m.common_cancel()}</Button>{/if}
		<details class="min-w-0">
			<summary class="cursor-pointer p-2 text-xs [@media(pointer:coarse)]:min-h-11"
				>{m.repurpose_focus()}</summary
			>
			<div class="pt-2">
				<Label for="repurpose-topic">{m.repurpose_topic()}</Label><Input
					id="repurpose-topic"
					bind:value={topic}
					maxlength={500}
					disabled={locked}
					placeholder={m.repurpose_topic_placeholder()}
				/>
			</div>
		</details>
	</div>
	{#if review.warning}<p role="status" class="text-sm text-muted-foreground">
			{review.warning}
		</p>{/if}
	{#if review.stale}<p role="status" class="text-sm text-muted-foreground">
			{m.repurpose_stale()}
		</p>{/if}
	{#if review.error}<p role="alert" class="text-sm text-destructive">{review.error}</p>{/if}
	{#if review.result?.state === 'failed' || review.result?.state === 'cancelled'}<Button
			variant="outline"
			disabled={locked}
			onclick={() => review.retry()}>{m.common_retry()}</Button
		>{/if}
	{#if review.result?.state === 'cancelled'}<p role="status" class="text-sm text-muted-foreground">
			{m.repurpose_cancelled()}
		</p>{/if}
	{#if review.result?.state === 'ready' && !review.candidates.length}<p
			role="status"
			class="text-sm"
		>
			{m.repurpose_empty()}
		</p>{/if}
	{#if !review.result && !review.busy && !review.error}<p
			class="max-w-xl text-sm text-muted-foreground"
		>
			{m.repurpose_ready_hint()}
		</p>{/if}
	{#if active}
		<div class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
			<div class="min-w-0 space-y-3">
				<div
					class="flex min-h-44 flex-col items-center justify-center gap-3 overflow-hidden rounded-md border bg-muted/30 p-2"
				>
					{#if preview}
						{#if context.source.selectedVideoTrackIndex !== null && context.source.videoStreams.length}
							<!-- svelte-ignore a11y_media_has_caption The adjacent transcript carries the spoken source words. -->
							<video
								bind:this={video}
								src={preview.url}
								controls
								playsinline
								class="max-h-[45vh] w-full"
								aria-label={m.repurpose_preview_label({ title: active.title })}
								ontimeupdate={() => {
									if (video) sourceTime = active.start + video.currentTime;
								}}
							></video>
						{:else}<audio
								bind:this={audio}
								src={preview.url}
								controls
								class="w-full"
								aria-label={m.repurpose_preview_label({ title: active.title })}
								ontimeupdate={() => {
									if (audio) sourceTime = active.start + audio.currentTime;
								}}
							></audio>{/if}
					{:else if previewBusy}
						<p role="status" class="text-sm">
							{m.repurpose_preparing({ progress: Math.round(previewProgress * 100) })}
						</p>
						<progress
							max="1"
							value={previewProgress}
							class="max-w-full"
							aria-label={m.repurpose_preview()}
						></progress><Button size="sm" variant="outline" onclick={disposePreview}
							>{m.common_cancel()}</Button
						>
					{:else}<p class="text-center text-xs text-muted-foreground">
							{m.repurpose_preview_hint()}
						</p>
						<Button variant="outline" onclick={preparePreview}>{m.repurpose_preview()}</Button>{/if}
				</div>
				{#if previewError}<p role="alert" class="text-sm text-destructive">{previewError}</p>{/if}
				<p class="text-xs text-muted-foreground">
					{m.repurpose_audio_track({ track: (review.snapshot?.audio_track_index ?? 0) + 1 })} · {time(
						active.start
					)} → {time(active.end)}
				</p>
				<div class="grid grid-cols-2 gap-3">
					<label class="min-w-0 space-y-1 text-xs"
						><span>{m.video_editor_property_start()}</span><SegmentTimeInput
							value={active.start}
							duration={context.source.duration}
							aria-label={m.video_editor_property_start()}
							disabled={locked || activeCreated}
							onCommit={(value) => review.adjustTime(active.id, 'first_word', value)}
						/><span class="block truncate text-muted-foreground"
							>{words[active.first_word]?.text}</span
						></label
					>
					<label class="min-w-0 space-y-1 text-xs"
						><span>{m.video_editor_property_end()}</span><SegmentTimeInput
							value={active.end}
							duration={context.source.duration}
							aria-label={m.video_editor_property_end()}
							disabled={locked || activeCreated}
							onCommit={(value) => review.adjustTime(active.id, 'last_word', value)}
						/><span class="block truncate text-muted-foreground"
							>{words[active.last_word]?.text}</span
						></label
					>
				</div>
				<div
					class="max-h-60 overflow-y-auto rounded-md border p-2 leading-loose"
					role="group"
					aria-label={m.repurpose_context()}
				>
					{#each words.slice(Math.max(0, active.first_word - 8), active.last_word + 9) as word, offset}
						{@const index = Math.max(0, active.first_word - 8) + offset}
						<button
							type="button"
							disabled={!preview || index < active.first_word || index > active.last_word}
							class="rounded px-1 py-1 text-sm focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-text [@media(pointer:coarse)]:min-h-11"
							class:text-muted-foreground={index < active.first_word || index > active.last_word}
							class:bg-accent={index >= active.first_word && index <= active.last_word}
							class:underline={sourceTime >= word.start && sourceTime < word.end}
							onclick={() => seek(word.start)}>{word.text.trim()}</button
						>
					{/each}
				</div>
			</div>
			<div class="min-w-0 space-y-3">
				{#each review.candidates as candidate (candidate.id)}
					{@const output = review.created.find((item) => item.candidateId === candidate.id)}
					<div
						class="space-y-2 rounded-md border p-3"
						class:border-primary={candidate.id === active.id}
					>
						<div class="flex items-start gap-2">
							<Checkbox
								class="mt-1 [@media(pointer:coarse)]:after:-inset-3.5"
								id={`include-${candidate.id}`}
								checked={candidate.selected}
								disabled={locked || Boolean(output)}
								onCheckedChange={(value) => review.select(candidate.id, value === true)}
								aria-label={m.repurpose_include({ title: candidate.title })}
							/><button
								type="button"
								class="min-w-0 flex-1 text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary [@media(pointer:coarse)]:min-h-11"
								aria-pressed={candidate.id === active.id}
								onclick={() => (activeId = candidate.id)}>{candidate.title}</button
							><span class="shrink-0 text-xs text-muted-foreground"
								>{Math.round(candidate.end - candidate.start)}s</span
							>
						</div>
						<p class="text-xs text-muted-foreground">{candidate.rationale}</p>
						{#if candidate.context_warning}<p class="text-xs">{candidate.context_warning}</p>{/if}
						{#if output}<a
								class="inline-block py-2 text-sm text-primary underline"
								href={resolve('/quick-cut') +
									`?project=${encodeURIComponent(output.projectId)}&storage=${output.storage}`}
								>{m.repurpose_open_project()}</a
							>{/if}
					</div>
				{/each}
				<Button
					class="w-full"
					disabled={locked || !pendingCount}
					onclick={() => review.createSelected()}
					>{review.creating
						? m.repurpose_creating()
						: m.repurpose_create({ count: pendingCount })}</Button
				>
				<p class="text-xs text-muted-foreground">{m.repurpose_create_hint()}</p>
				{#if review.creating && review.creationProgress}<div
						role="status"
						class="flex items-center gap-2 text-xs"
					>
						<span>{review.creationProgress.completed}/{review.creationProgress.total}</span
						><progress
							max="1"
							value={review.creationProgress.fraction}
							aria-label={m.repurpose_creating()}
							class="min-w-0 flex-1"
						></progress>{#if review.creationProgress.fraction !== undefined}<span
								>{Math.round(review.creationProgress.fraction * 100)}%</span
							>{/if}
					</div>{/if}
				{#if review.creating}<Button variant="outline" onclick={() => review.cancel()}
						>{m.common_cancel()}</Button
					>{/if}
				{#if review.created.length}<p role="status" class="text-sm">
						{m.repurpose_created({ count: review.created.length })}
					</p>{/if}
			</div>
		</div>
	{/if}
</div>
