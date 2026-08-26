import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { resolveItemRef } from './clip-refs';
import { buildClipRefs } from './clip-refs';

export interface TranscriptSearchMatch {
	itemId: string;
	timelineSeconds: number;
	snippet: string;
}

const WINDOW_TOKENS = 16;
const SNIPPET_BEFORE = 2;
const SNIPPET_AFTER = 8;

interface SearchToken {
	itemId: string;
	startFrame: number;
	text: string;
}

function collectTokens(fps: number): SearchToken[] {
	const tokens: SearchToken[] = [];
	for (const item of timelineStore.items) {
		if (item.type !== 'subtitle' || !item.cues) continue;
		for (const cue of item.cues) {
			for (const word of cue.words ?? []) {
				if (!word.text.trim()) continue;
				tokens.push({
					itemId: item.id,
					startFrame: word.startFrame,
					text: word.text
				});
			}
			if (!cue.words || cue.words.length === 0) {
				const raw = cue.text.trim();
				if (!raw) continue;
				const parts = raw.split(/\s+/);
				for (const part of parts) {
					if (!part) continue;
					tokens.push({ itemId: item.id, startFrame: cue.startFrame, text: part });
				}
			}
		}
	}
	tokens.sort((a, b) => {
		const frameA = a.startFrame;
		const frameB = b.startFrame;
		if (frameA !== frameB) return frameA - frameB;
		return a.itemId.localeCompare(b.itemId);
	});
	void fps;
	return tokens;
}

export async function searchTimelineTranscript(
	query: string,
	limit = 8
): Promise<TranscriptSearchMatch[]> {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	const fps = Math.max(1, timelineStore.fps);
	const tokens = collectTokens(fps);
	if (tokens.length === 0) return [];
	const lower = tokens.map((token) => token.text.toLowerCase());
	buildClipRefs();
	const matches: TranscriptSearchMatch[] = [];
	for (let i = 0; i < tokens.length && matches.length < limit; i++) {
		let windowText = '';
		let end = i;
		while (
			end < tokens.length &&
			end < i + WINDOW_TOKENS &&
			windowText.length < needle.length + 48
		) {
			const word = lower[end];
			if (word) windowText += (end > i ? ' ' : '') + word;
			end++;
		}
		if (!windowText.includes(needle)) continue;
		const anchor = tokens[i];
		if (!anchor) continue;
		const snippet = tokens
			.slice(Math.max(0, i - SNIPPET_BEFORE), Math.min(tokens.length, i + SNIPPET_AFTER))
			.map((token) => token.text)
			.join(' ');
		void resolveItemRef(anchor.itemId);
		matches.push({
			itemId: anchor.itemId,
			timelineSeconds: anchor.startFrame / fps,
			snippet
		});
		i = end - 1;
	}
	return matches;
}
