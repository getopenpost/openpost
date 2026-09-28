<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import TranscriptCueDetails from './transcript-cue-details.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { ThemeIcon } from '$lib/themes/icons';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import { addTextItemAtFrame, setCurrentFrame } from '../timeline/actions/items';
	import { execute } from '../timeline/commands/command-store.svelte';
	import { transcriptDocument, selectedTranscriptCues } from '../transcript/transcript-document';
	import { correctedCueWords } from '../transcript/caption-correction';
	import {
		buildCueText,
		getCueFormatFlags,
		parseSubtitleCueText
	} from '../transcript/subtitle-cue-format';
	import { findTranscriptWordMatches } from '../transcript/fuzzy-search';
	import { buildTranscriptSelectionRanges } from '../transcript/transcript-edit-model';
	import { applyTranscriptTargetRangeRemoval } from '../transcript/speech-cleanup-actions';
	import { buildTranscriptClipboardItems } from '../transcript/transcript-clipboard';
	import { registerTranscriptCopyHandler } from '../transcript/transcript-copy-bridge';
	import { itemClipboardStore } from '../timeline/stores/item-clipboard-store.svelte';
	import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
	import { effectiveMediaTracks } from '../timeline/utils/track-groups';
	import {
		createBrowserPointerGestureSessionHost,
		type PointerGestureSessionHost
	} from '../timeline/pointer-gesture-session';
	import { formatTimelinePreviewTimecode } from '../preview/timeline-preview-scrub';
	import type { TranscriptSourceWord } from '../transcript/speech-cleanup';

	let {
		onedit,
		ontextinserted,
		itemIds = [],
		showHeading = true
	}: {
		onedit: () => void;
		ontextinserted?: (itemId: string) => void;
		itemIds?: string[];
		showHeading?: boolean;
	} = $props();
	const MIN_STICKY_PANEL_HEIGHT = 240;
	let panelHeight = $state(0);
	let panel: HTMLDivElement;
	let searchBar: HTMLDivElement;
	let selectionToolbar = $state<HTMLDivElement>();
	let search = $state('');
	let matchIndex = $state(-1);
	let scope = $state<'project' | 'selection'>('project');
	let anchorId = $state<string | null>(null);
	let focusId = $state<string | null>(null);
	let dragging = $state(false);
	let dragScrollFrame = 0;
	let autoScroll = $state(true);
	let showPauses = $state(false);
	let settingsOpen = $state(false);
	let drafts = $state<Record<string, string> | null>(null);
	let status = $state('');
	let gestures: PointerGestureSessionHost | null = null;
	let unregisterCopy: (() => void) | undefined;
	const words = $derived(
		transcriptDocument(
			timelineStore.items,
			timelineStore.fps,
			scope === 'selection' && itemIds.length ? itemIds : undefined
		)
	);
	const anchor = $derived(words.findIndex((word) => word.id === anchorId));
	const focus = $derived(words.findIndex((word) => word.id === focusId));
	const selected = $derived(
		anchor < 0 || focus < 0 ? [] : words.slice(Math.min(anchor, focus), Math.max(anchor, focus) + 1)
	);
	const sourceWords = $derived(
		selected.map((word) => word.source).filter((word): word is TranscriptSourceWord => !!word)
	);
	const selectedCues = $derived(selectedTranscriptCues(selected, timelineStore.items));
	const lockedTracks = $derived(
		new Set(
			effectiveMediaTracks(timelineStore.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		)
	);
	const canCorrect = $derived(
		selectedCues.length > 0 && selectedCues.every(({ item }) => !lockedTracks.has(item.trackId))
	);
	const canCut = $derived(
		selected.length > 0 &&
			sourceWords.length === selected.length &&
			sourceWords.every((word) => {
				const source = word.sourceItemId
					? timelineStore.itemById.get(word.sourceItemId)
					: undefined;
				return source && !lockedTracks.has(source.trackId);
			})
	);
	const canAddText = $derived(
		selected.length > 0 &&
			effectiveMediaTracks(timelineStore.tracks).some(
				(track) => track.kind !== 'audio' && !track.locked
			)
	);
	const matches = $derived(
		findTranscriptWordMatches(
			words.map((word) => word.text),
			search
		)
	);
	const matchedIndices = $derived(
		new Set(
			matches.spans.flatMap((span) =>
				Array.from({ length: span.end - span.start + 1 }, (_, i) => span.start + i)
			)
		)
	);
	const activeIndex = $derived(
		words.findIndex(
			(word) =>
				timelineStore.currentFrame >= word.startFrame && timelineStore.currentFrame < word.endFrame
		)
	);
	const paragraphs = $derived.by(() => {
		const groups: number[][] = [];
		words.forEach((word, index) => {
			const previous = words[index - 1];
			const group = groups.at(-1);
			if (
				!previous ||
				previous.itemId !== word.itemId ||
				word.startFrame - previous.endFrame >= timelineStore.fps ||
				(group && group.length >= 40 && /[.!?]$/.test(previous.text))
			)
				groups.push([index]);
			else group?.push(index);
		});
		return groups;
	});

	onMount(() => {
		gestures = createBrowserPointerGestureSessionHost();
		unregisterCopy = registerTranscriptCopyHandler({
			isActive: () => !!panel?.contains(document.activeElement) && selected.length > 0 && !drafts,
			copy: (cut) => copyWords(cut)
		});
	});
	onDestroy(() => {
		gestures?.destroy();
		stopDragSelection();
		unregisterCopy?.();
	});
	$effect(() => {
		if ((anchorId && anchor < 0) || (focusId && focus < 0)) clearSelection();
	});
	$effect(() => {
		if (autoScroll && activeIndex >= 0 && !drafts && !dragging) scrollToWord(activeIndex);
	});
	function scrollToWord(index: number) {
		void tick().then(() =>
			panel
				?.querySelector<HTMLElement>(`[data-transcript-word="${index}"]`)
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		);
	}
	function clearSelection() {
		anchorId = null;
		focusId = null;
		drafts = null;
	}
	function selectWord(index: number, extend = false) {
		if (!words[index]) return;
		if (!extend || anchor < 0) anchorId = words[index]!.id;
		focusId = words[index]!.id;
		drafts = null;
		setCurrentFrame(words[index].startFrame);
	}
	function stopDragSelection() {
		dragging = false;
		cancelAnimationFrame(dragScrollFrame);
	}
	function startSelection(index: number, event: PointerEvent) {
		if (event.button !== 0) return;
		selectWord(index, event.shiftKey);
		panel.focus({ preventScroll: true });
		dragging = true;
		let pointer = { x: event.clientX, y: event.clientY };
		let scroller: HTMLElement | null = panel;
		while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
			scroller = scroller.parentElement;
		const extendSelection = () => {
			const bounds = scroller?.getBoundingClientRect();
			const top = Math.max(bounds?.top ?? 0, searchBar.getBoundingClientRect().bottom);
			const bottom = Math.min(
				bounds?.bottom ?? window.innerHeight,
				selectionToolbar?.getBoundingClientRect().top ?? window.innerHeight
			);
			const y = Math.max(top + 2, Math.min(bottom - 2, pointer.y));
			const target = document
				.elementFromPoint(pointer.x, y)
				?.closest<HTMLElement>('[data-transcript-word]');
			if (target && panel.contains(target)) {
				focusId = words[Number(target.dataset.transcriptWord)]?.id ?? focusId;
				return;
			}
			if (pointer.y >= top && pointer.y <= bottom) return;
			let nearest: HTMLElement | undefined;
			let distance = Infinity;
			for (const word of panel.querySelectorAll<HTMLElement>('[data-transcript-word]')) {
				const rect = word.getBoundingClientRect();
				if (rect.bottom <= top || rect.top >= bottom) continue;
				const nextDistance = Math.hypot(
					Math.max(rect.left - pointer.x, 0, pointer.x - rect.right),
					Math.max(rect.top - y, 0, y - rect.bottom)
				);
				if (nextDistance < distance) {
					nearest = word;
					distance = nextDistance;
				}
			}
			if (nearest) focusId = words[Number(nearest.dataset.transcriptWord)]?.id ?? focusId;
		};
		const scrollAtEdge = () => {
			if (!dragging) return;
			if (scroller) {
				const bounds = scroller.getBoundingClientRect();
				const edge = 36;
				const delta =
					pointer.y < bounds.top + edge
						? pointer.y - bounds.top - edge
						: pointer.y > bounds.bottom - edge
							? pointer.y - bounds.bottom + edge
							: 0;
				if (delta) {
					scroller.scrollTop += Math.max(-12, Math.min(12, delta / 3));
					extendSelection();
				}
			}
			dragScrollFrame = requestAnimationFrame(scrollAtEdge);
		};
		dragScrollFrame = requestAnimationFrame(scrollAtEdge);
		gestures?.start({
			pointerId: event.pointerId,
			target: panel,
			onMove: (move) => {
				pointer = { x: move.clientX, y: move.clientY };
				extendSelection();
			},
			onCommit: stopDragSelection,
			onCancel: (reason) => {
				stopDragSelection();
				if (reason === 'escape') clearSelection();
			}
		});
		event.preventDefault();
	}
	function deleteVideo() {
		if (!canCut) return;
		const result = applyTranscriptTargetRangeRemoval(buildTranscriptSelectionRanges(sourceWords));
		if (!result.removedItemCount) return;
		status = m.video_editor_transcript_cut_words({ count: selected.length });
		clearSelection();
		onedit();
	}
	function copyWords(cut: boolean) {
		if (!selected.length || (cut && !canCut)) return;
		const text = selected.map((word) => word.text).join(' ');
		const clips = buildTranscriptClipboardItems(
			sourceWords,
			timelineStore.items.map((item) => snapshotTimelineState(item)),
			timelineStore.fps
		);
		if (clips.length) itemClipboardStore.copy(clips, cut ? 'cut' : 'copy');
		void navigator.clipboard?.writeText(text).catch(() => undefined);
		if (cut) deleteVideo();
		else
			status = m.video_editor_transcript_copied_words({
				count: selected.length
			});
	}
	function beginCorrection() {
		drafts = Object.fromEntries(
			selectedCues.map(({ item, cue }) => [
				`${item.id}:${cue.id}`,
				parseSubtitleCueText(cue.text).plainText
			])
		);
		void tick().then(() => panel.querySelector<HTMLTextAreaElement>('textarea')?.focus());
	}
	function saveCorrection() {
		if (!drafts || !canCorrect) return;
		const changes = drafts;
		execute('EDIT_CUE', () =>
			timelineStore._updateItems(
				timelineStore.items
					.filter((item) => selectedCues.some((entry) => entry.item.id === item.id))
					.map((item) => ({
						id: item.id,
						patch: {
							cues: item.cues?.map((cue) => {
								const next = changes[`${item.id}:${cue.id}`];
								if (next === undefined) return cue;
								return {
									...cue,
									text: buildCueText(
										next,
										getCueFormatFlags(parseSubtitleCueText(cue.text)),
										cue.text
									),
									words: correctedCueWords(cue, next)
								};
							})
						}
					}))
			)
		);
		drafts = null;
		onedit();
	}
	function addText() {
		if (!canAddText) return;
		const text = selected.map((word) => word.text).join(' ');
		const frame = Math.min(...selected.map((word) => word.startFrame));
		const id = addTextItemAtFrame(text, frame);
		ontextinserted?.(id);
		setCurrentFrame(frame);
		status = m.video_editor_transcript_text_added();
		onedit();
	}
	function findMatch(direction: number) {
		if (!matches.spans.length) return;
		matchIndex =
			matchIndex < 0
				? direction < 0
					? matches.spans.length - 1
					: 0
				: (matchIndex + direction + matches.spans.length) % matches.spans.length;
		const span = matches.spans[matchIndex]!;
		setCurrentFrame(words[span.start]!.startFrame);
		scrollToWord(span.start);
	}
	function onKeydown(event: KeyboardEvent) {
		if (!(event.target instanceof Node) || !panel?.contains(event.target)) return;
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
			return;
		if ((event.metaKey || event.ctrlKey) && ['c', 'x', 'a'].includes(event.key.toLowerCase())) {
			event.preventDefault();
			event.stopPropagation();
			if (event.key.toLowerCase() === 'a') {
				anchorId = words[0]?.id ?? null;
				focusId = words.at(-1)?.id ?? null;
			} else copyWords(event.key.toLowerCase() === 'x');
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			event.stopPropagation();
			deleteVideo();
		} else if (event.key === 'Escape') {
			event.stopPropagation();
			clearSelection();
		} else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			const index = Math.max(
				0,
				Math.min(words.length - 1, focus + (event.key === 'ArrowRight' ? 1 : -1))
			);
			selectWord(index, event.shiftKey);
			scrollToWord(index);
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	bind:this={panel}
	bind:clientHeight={panelHeight}
	class="video-editor-theme transcript-document flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2 [&>*]:shrink-0"
	role="region"
	aria-label={m.video_editor_transcript()}
	tabindex="-1"
	data-editor-shortcuts-owned
	data-testid="transcript-panel"
>
	<div
		bind:this={searchBar}
		class="top-0 z-20 flex min-w-0 items-center gap-2 bg-card py-1"
		class:sticky={panelHeight >= MIN_STICKY_PANEL_HEIGHT}
	>
		{#if showHeading}<h3 class="text-sm font-medium">
				{m.video_editor_transcript()}
			</h3>{/if}
		<div class="relative min-w-0 flex-1">
			<Input
				type="search"
				class="h-8 min-w-0 text-xs"
				placeholder={m.video_editor_transcript_search()}
				aria-label={m.video_editor_transcript_search()}
				value={search}
				oninput={(event) => {
					search = event.currentTarget.value;
					matchIndex = -1;
				}}
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						findMatch(event.shiftKey ? -1 : 1);
					}
				}}
			/>
		</div>
		<Button
			size="icon-xs"
			variant="ghost"
			aria-label={m.video_editor_transcript_options()}
			aria-expanded={settingsOpen}
			onclick={() => (settingsOpen = !settingsOpen)}
			><ThemeIcon role="settings" class="size-4" /></Button
		>
	</div>
	{#if search}
		<div
			class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
			aria-live="polite"
		>
			<span
				>{matches.spans.length
					? `${Math.max(0, matchIndex + 1)}/${matches.spans.length}`
					: m.video_editor_transcript_search_empty()}</span
			>
			<div class="flex gap-1">
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={m.video_editor_transcript_search_previous()}
					disabled={!matches.spans.length}
					onclick={() => findMatch(-1)}><ThemeIcon role="chevron-up" class="size-3" /></Button
				>
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={m.video_editor_transcript_search_next()}
					disabled={!matches.spans.length}
					onclick={() => findMatch(1)}><ThemeIcon role="chevron-down" class="size-3" /></Button
				>
			</div>
		</div>
	{/if}
	{#if settingsOpen}
		<div class="flex flex-wrap items-center gap-2 border-b border-border pb-2">
			<Button
				size="sm"
				variant={autoScroll ? 'secondary' : 'ghost'}
				aria-pressed={autoScroll}
				onclick={() => (autoScroll = !autoScroll)}>{m.video_editor_transcript_auto_scroll()}</Button
			>
			<Button
				size="sm"
				variant={showPauses ? 'secondary' : 'ghost'}
				aria-pressed={showPauses}
				onclick={() => (showPauses = !showPauses)}>{m.video_editor_transcript_show_pauses()}</Button
			>
			{#if itemIds.length}<Button
					size="sm"
					variant={scope === 'selection' ? 'secondary' : 'ghost'}
					aria-pressed={scope === 'selection'}
					onclick={() => {
						scope = scope === 'selection' ? 'project' : 'selection';
						clearSelection();
					}}>{m.video_editor_transcript_only_selection()}</Button
				>{/if}
		</div>
	{/if}
	{#if !words.length}
		<p class="py-8 text-center text-sm text-muted-foreground">
			{m.video_editor_transcript_empty()}
		</p>
	{:else}
		<p class="text-xs leading-relaxed text-muted-foreground">
			{m.video_editor_transcript_read_help()}
		</p>
		<div class="space-y-5 pb-4" data-testid="transcript-text">
			{#each paragraphs as paragraph (words[paragraph[0]!]!.id)}
				{@const first = words[paragraph[0]!]!}
				<div>
					<button
						type="button"
						class="mb-1 text-[11px] text-muted-foreground tabular-nums hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
						title={timelineStore.itemById.get(first.itemId)?.label}
						onclick={() => setCurrentFrame(first.startFrame)}
						>{formatTimelinePreviewTimecode(first.startFrame, timelineStore.fps)}</button
					>
					<p class="text-sm leading-8 break-words" dir="auto">
						{#each paragraph as index (words[index]!.id)}
							{@const word = words[index]!}
							{@const previous = words[index - 1]}
							{#if showPauses && previous && previous.itemId === word.itemId && word.startFrame - previous.endFrame >= timelineStore.fps / 2}
								<span
									class="mx-1 inline-block rounded bg-muted px-1.5 text-xs text-muted-foreground"
									aria-label={m.video_editor_transcript_pause({
										duration: ((word.startFrame - previous.endFrame) / timelineStore.fps).toFixed(1)
									})}
									>{m.video_editor_transcript_pause({
										duration: ((word.startFrame - previous.endFrame) / timelineStore.fps).toFixed(1)
									})}</span
								>
							{/if}
							<button
								type="button"
								class="transcript-word -mx-0.5 rounded-sm px-0.5 text-start focus-visible:outline-2 focus-visible:outline-ring"
								data-transcript-word={index}
								data-selected={anchor >= 0 &&
									index >= Math.min(anchor, focus) &&
									index <= Math.max(anchor, focus)}
								data-active={activeIndex === index}
								data-match={matchedIndices.has(index)}
								aria-pressed={anchor >= 0 &&
									index >= Math.min(anchor, focus) &&
									index <= Math.max(anchor, focus)}
								onpointerdown={(event) => startSelection(index, event)}
								onclick={(event) => {
									if (event.detail === 0) selectWord(index, event.shiftKey);
								}}>{word.text}</button
							>
							<!-- eslint-disable-next-line svelte/no-useless-mustaches -- Keep a word separator across the each-block boundary. -->
							{' '}
						{/each}
					</p>
				</div>
			{/each}
		</div>
	{/if}
	{#if selected.length}
		<div
			bind:this={selectionToolbar}
			class:sticky={panelHeight >= MIN_STICKY_PANEL_HEIGHT}
			class="bottom-0 z-10 grid grid-cols-2 items-center gap-1 rounded-md border border-border bg-card p-1.5 shadow-sm"
			role="toolbar"
			aria-label={m.video_editor_transcript_words_selected({
				count: selected.length
			})}
		>
			<Button
				class="px-2 text-xs"
				size="sm"
				variant="ghost"
				disabled={!canCorrect}
				onclick={beginCorrection}>{m.video_editor_transcript_correct()}</Button
			>
			<Button
				class="px-2 text-xs"
				size="sm"
				variant="ghost"
				disabled={!canAddText}
				onclick={addText}>{m.video_editor_transcript_add_text()}</Button
			>
			<Button
				class="px-2 text-xs"
				size="sm"
				variant="ghost"
				disabled={!canCut}
				onclick={deleteVideo}>{m.video_editor_transcript_delete_video()}</Button
			>
			<Button size="icon-xs" variant="ghost" aria-label={m.common_close()} onclick={clearSelection}
				><ThemeIcon role="close" class="size-3" /></Button
			>
		</div>
		{#if !canCut}<p class="text-xs text-muted-foreground">
				{m.video_editor_transcript_cut_unavailable()}
			</p>{/if}
	{/if}
	{#if drafts}
		<form
			class="space-y-2 rounded-md border border-border p-3"
			onsubmit={(event) => {
				event.preventDefault();
				saveCorrection();
			}}
		>
			<p class="text-xs text-muted-foreground">
				{m.video_editor_transcript_correct_help()}
			</p>
			{#each selectedCues as { item, cue } (`${item.id}:${cue.id}`)}
				<Textarea
					aria-label={m.video_editor_transcript_line()}
					class="min-h-20 text-sm"
					bind:value={drafts[`${item.id}:${cue.id}`]}
				/>
			{/each}
			<div class="flex flex-wrap gap-2">
				<Button
					type="submit"
					size="sm"
					disabled={Object.values(drafts).some((text) => !text.trim())}
					>{m.video_editor_transcript_save_correction()}</Button
				><Button size="sm" variant="ghost" onclick={() => (drafts = null)}
					>{m.common_cancel()}</Button
				>
			</div>
		</form>
	{/if}
	{#if canCorrect && !drafts}<TranscriptCueDetails entries={selectedCues} {onedit} />{/if}
	<p class="text-xs text-muted-foreground" role="status">{status}</p>
</div>

<style>
	.transcript-word {
		user-select: none;
		cursor: text;
	}
	.transcript-word:hover {
		background: var(--muted);
	}
	.transcript-word[data-match='true'] {
		box-shadow: inset 0 -2px var(--video-editor-focus);
	}
	.transcript-word[data-active='true'] {
		background: var(--muted);
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	.transcript-word[data-selected='true'] {
		background: var(--primary);
		color: var(--primary-foreground);
	}
	@media (pointer: coarse) {
		.transcript-word {
			min-height: 44px;
		}
	}
</style>
