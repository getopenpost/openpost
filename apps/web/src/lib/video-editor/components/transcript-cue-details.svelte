<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Disclosure from '$lib/components/editor-density/disclosure.svelte';
	import type { SubtitleCue, SubtitleWord, TimelineItem } from '../project/types';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import { execute } from '../timeline/commands/command-store.svelte';
	import {
		correctedCueTimingPatch,
		captionTimingBounds,
		correctedSubtitleWord,
		correctedCueWordText
	} from '../transcript/caption-correction';
	import {
		getCueFormatFlags,
		parseSubtitleCueText,
		toggleCueFormat,
		type CueFormatFlags
	} from '../transcript/subtitle-cue-format';

	let {
		entries,
		onedit
	}: { entries: Array<{ item: TimelineItem; cue: SubtitleCue }>; onedit: () => void } = $props();
	let timingFeedback = $derived<Record<string, string>>(
		Object.fromEntries(entries.map(({ item, cue }) => [`${item.id}:${cue.id}`, '']))
	);
	function timingRejected(
		item: TimelineItem,
		cue: SubtitleCue,
		input: HTMLInputElement,
		accepted: number
	): void {
		input.value = String(accepted);
		timingFeedback = {
			...timingFeedback,
			[`${item.id}:${cue.id}`]: m.video_editor_caption_timing_invalid(captionTimingBounds(item))
		};
	}
	function updateCueTiming(
		item: TimelineItem,
		cue: SubtitleCue,
		input: HTMLInputElement,
		field: 'startFrame' | 'endFrame'
	): void {
		const next = correctedCueTimingPatch(
			cue,
			field === 'startFrame' ? input.valueAsNumber : cue.startFrame,
			field === 'endFrame' ? input.valueAsNumber : cue.endFrame,
			captionTimingBounds(item)
		);
		if (!next) {
			timingRejected(item, cue, input, cue[field]);
			return;
		}
		timingFeedback = { ...timingFeedback, [`${item.id}:${cue.id}`]: '' };
		if (next.startFrame === cue.startFrame && next.endFrame === cue.endFrame) return;
		replaceCue(item, cue.id, { ...cue, ...next });
	}
	function updateWordTiming(
		item: TimelineItem,
		cue: SubtitleCue,
		word: SubtitleWord,
		input: HTMLInputElement,
		field: 'startFrame' | 'endFrame'
	): void {
		if (input.valueAsNumber === word[field]) {
			timingFeedback = { ...timingFeedback, [`${item.id}:${cue.id}`]: '' };
			return;
		}
		if (!updateWord(item, cue, word.id, { [field]: input.valueAsNumber })) {
			timingRejected(item, cue, input, word[field]);
			return;
		}
		timingFeedback = { ...timingFeedback, [`${item.id}:${cue.id}`]: '' };
	}
	function replaceCue(item: TimelineItem, cueId: string, next: SubtitleCue | null) {
		execute('EDIT_CUE', () =>
			timelineStore._updateItems([
				{
					id: item.id,
					patch: {
						cues: item.cues?.flatMap((cue) => (cue.id !== cueId ? [cue] : next ? [next] : []))
					}
				}
			])
		);
		onedit();
	}
	function updateWord(
		item: TimelineItem,
		cue: SubtitleCue,
		wordId: string,
		patch: Partial<SubtitleWord>
	): boolean {
		const corrected = correctedSubtitleWord(cue, wordId, patch, captionTimingBounds(item));
		if (!corrected) return false;
		replaceCue(item, cue.id, {
			...cue,
			...corrected,
			text: correctedCueWordText(cue, corrected.words)
		});
		return true;
	}
	function deleteWord(item: TimelineItem, cue: SubtitleCue, wordId: string) {
		const words = cue.words?.filter((word) => word.id !== wordId) ?? [];
		replaceCue(
			item,
			cue.id,
			words.length
				? {
						...cue,
						words,
						text: correctedCueWordText(cue, words),
						startFrame: Math.min(...words.map((word) => word.startFrame)),
						endFrame: Math.max(...words.map((word) => word.endFrame))
					}
				: null
		);
	}
	const formats: Array<{ key: keyof CueFormatFlags; label: () => string; text: string }> = [
		{ key: 'bold', label: m.video_editor_caption_bold, text: 'B' },
		{ key: 'italic', label: m.video_editor_text_italic, text: 'I' },
		{ key: 'underline', label: m.video_editor_text_underline, text: 'U' }
	];
</script>

<Disclosure label={m.video_editor_caption_style()}>
	<div class="space-y-3 py-2">
		{#each entries as { item, cue } (`${item.id}:${cue.id}`)}
			{@const flags = getCueFormatFlags(parseSubtitleCueText(cue.text))}
			{@const bounds = captionTimingBounds(item)}
			{@const feedbackId = `caption-timing-${item.id}-${cue.id}`}
			<section class="space-y-2" aria-label={parseSubtitleCueText(cue.text).plainText}>
				<p class="text-xs text-muted-foreground">{parseSubtitleCueText(cue.text).plainText}</p>
				<div class="flex flex-wrap gap-1">
					{#each formats as format}
						<Button
							size="icon-xs"
							variant={flags[format.key] ? 'secondary' : 'ghost'}
							aria-label={format.label()}
							aria-pressed={flags[format.key]}
							onclick={() =>
								replaceCue(item, cue.id, { ...cue, text: toggleCueFormat(cue.text, format.key) })}
							>{format.text}</Button
						>
					{/each}
					<Button size="sm" variant="ghost" onclick={() => replaceCue(item, cue.id, null)}
						>{m.video_editor_transcript_delete_line()}</Button
					>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<label class="space-y-1 text-xs"
						>{m.video_editor_adjust_caption_start()}<Input
							type="number"
							min={bounds.start}
							max={bounds.end}
							step="1"
							value={cue.startFrame}
							aria-describedby={timingFeedback[`${item.id}:${cue.id}`] ? feedbackId : undefined}
							onchange={(event) => updateCueTiming(item, cue, event.currentTarget, 'startFrame')}
						/></label
					>
					<label class="space-y-1 text-xs"
						>{m.video_editor_adjust_caption_end()}<Input
							type="number"
							min={bounds.start}
							max={bounds.end}
							step="1"
							value={cue.endFrame}
							aria-describedby={timingFeedback[`${item.id}:${cue.id}`] ? feedbackId : undefined}
							onchange={(event) => updateCueTiming(item, cue, event.currentTarget, 'endFrame')}
						/></label
					>
				</div>
				{#if timingFeedback[`${item.id}:${cue.id}`]}
					<p id={feedbackId} role="status" class="text-xs text-muted-foreground">
						{timingFeedback[`${item.id}:${cue.id}`]}
					</p>
				{/if}
				{#if cue.words?.length}
					<Disclosure label={m.video_editor_composition_timeline_timing()}>
						<div class="space-y-2">
							{#each cue.words as word (word.id)}
								<div class="grid grid-cols-2 gap-1 rounded border border-border p-2">
									<label class="col-span-2 text-xs"
										>{m.video_editor_transcript_word()}<Input
											value={word.text}
											onchange={(event) =>
												event.currentTarget.value.trim()
													? updateWord(item, cue, word.id, { text: event.currentTarget.value })
													: deleteWord(item, cue, word.id)}
										/></label
									>
									<label class="text-xs"
										>{m.video_editor_transcript_word_start()}<Input
											type="number"
											min={bounds.start}
											max={bounds.end}
											step="1"
											value={word.startFrame}
											aria-describedby={timingFeedback[`${item.id}:${cue.id}`]
												? feedbackId
												: undefined}
											onchange={(event) =>
												updateWordTiming(item, cue, word, event.currentTarget, 'startFrame')}
										/></label
									>
									<label class="text-xs"
										>{m.video_editor_transcript_word_end()}<Input
											type="number"
											min={bounds.start}
											max={bounds.end}
											step="1"
											value={word.endFrame}
											aria-describedby={timingFeedback[`${item.id}:${cue.id}`]
												? feedbackId
												: undefined}
											onchange={(event) =>
												updateWordTiming(item, cue, word, event.currentTarget, 'endFrame')}
										/></label
									>
									<Button
										class="col-span-2"
										size="sm"
										variant="ghost"
										onclick={() => deleteWord(item, cue, word.id)}
										>{m.video_editor_transcript_word_delete()}</Button
									>
								</div>
							{/each}
						</div>
					</Disclosure>
				{/if}
			</section>
		{/each}
	</div>
</Disclosure>
