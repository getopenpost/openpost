/**
 * Deterministic karaoke word-highlight logic shared by preview and export.
 *
 * Preview-layer and TimelineFrameRenderer must resolve the identical active
 * word for the same cue and frame so burned subtitles match the live preview.
 */

import type { SubtitleCue, SubtitleWord, TimelineItem } from '../project/types';

export const KARAOKE_DEFAULT_ACTIVE_COLOR = '#FFD400';
export const KARAOKE_DEFAULT_ACTIVE_BACKGROUND = '';

export type CaptionHighlightMode = 'normal' | 'karaoke';

export function karaokeModeOf(
	item: Pick<TimelineItem, 'captionHighlightMode'>
): CaptionHighlightMode {
	return item.captionHighlightMode === 'karaoke' ? 'karaoke' : 'normal';
}

export function isKaraokeEnabled(item: Pick<TimelineItem, 'captionHighlightMode'>): boolean {
	return item.captionHighlightMode === 'karaoke';
}

/**
 * Return the index of the active word at the given absolute frame, or -1 when
 * no word is active. Boundaries are inclusive-start / exclusive-end so a frame
 * that equals both the previous end and the next start highlights the next word.
 */
export function activeWordIndexAtFrame(
	words: readonly SubtitleWord[] | undefined,
	frame: number
): number {
	if (!words || words.length === 0) return -1;
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		if (!word) continue;
		if (word.startFrame <= frame && frame < word.endFrame) return index;
	}
	return -1;
}

function tokensFromPlainText(plainText: string): string[] {
	const trimmed = plainText.trim();
	if (!trimmed) return [];
	return trimmed.split(/\s+/);
}

/**
 * Whether a cue has usable word-level timings for karaoke.
 * Requires: words exist, every word has start < end, token count matches
 * word count, and each token equals the corresponding word text.
 * Any mismatch forces a normal-caption fallback so cues never flicker.
 */
export function hasUsableKaraokeTimings(cue: SubtitleCue, plainText: string): boolean {
	const words = cue.words;
	if (!words || words.length === 0) return false;
	for (const word of words) {
		if (!Number.isFinite(word.startFrame) || !Number.isFinite(word.endFrame)) return false;
		if (word.startFrame >= word.endFrame) return false;
	}
	const tokens = tokensFromPlainText(plainText);
	if (tokens.length !== words.length) return false;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index] !== words[index]?.text) return false;
	}
	return true;
}

export function hasUsableWordTimings(cue: SubtitleCue): boolean {
	const words = cue.words;
	if (!words || words.length === 0) return false;
	for (const word of words) if (word.startFrame >= word.endFrame) return false;
	return true;
}

/**
 * Derive karaoke state for one cue at one frame.
 * Returns null when karaoke is disabled, the cue has no usable timings,
 * or no word is active at that frame (caller should render normally).
 */
export function karaokeStateAtFrame(
	item: Pick<
		TimelineItem,
		'captionHighlightMode' | 'karaokeActiveColor' | 'karaokeActiveBackground'
	>,
	cue: SubtitleCue,
	plainText: string,
	frame: number
): { activeIndex: number; words: readonly SubtitleWord[] } | null {
	if (!isKaraokeEnabled(item)) return null;
	if (!hasUsableKaraokeTimings(cue, plainText)) return null;
	const activeIndex = activeWordIndexAtFrame(cue.words, frame);
	if (activeIndex < 0) return null;
	return { activeIndex, words: cue.words! };
}

export function karaokeActiveColorOf(
	item: Pick<TimelineItem, 'karaokeActiveColor'>,
	fallback = KARAOKE_DEFAULT_ACTIVE_COLOR
): string {
	return item.karaokeActiveColor ?? fallback;
}

export function karaokeActiveBackgroundOf(
	item: Pick<TimelineItem, 'karaokeActiveBackground'>
): string | undefined {
	const value = item.karaokeActiveBackground?.trim();
	return value ? value : undefined;
}
