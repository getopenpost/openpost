import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { buildClipRefs } from './clip-refs';

function formatSeconds(value: number): string {
	return value.toFixed(1);
}

export interface TimelineContextSnapshot {
	text: string;
	fps: number;
	selectedCount: number;
	clipCount: number;
}

function escapeLabel(label: string): string {
	return label.replaceAll('"', "'").replace(/\r?\n/g, ' ').trim().slice(0, 40);
}

export function buildTimelineContext(
	selectedIds: readonly string[] = [],
	clipCountOverride?: number
): TimelineContextSnapshot {
	const fps = timelineStore.fps;
	const safeFps = Math.max(1, fps);
	const items = timelineStore.items;
	const clips = buildClipRefs(items, selectedIds);
	const maxEnd = items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0);

	const lines = [
		`Project: ${formatSeconds(maxEnd / safeFps)}s long at ${fps}fps. Playhead at ${formatSeconds(timelineStore.currentFrame / safeFps)}s.`
	];
	if (clips.length === 0) {
		lines.push('Clips: none.');
	} else {
		lines.push('Clips (ref · type · label · start-end · [selected]):');
		for (const clip of clips) {
			lines.push(
				`  ${clip.ref} ${clip.type} "${escapeLabel(clip.label)}" ${formatSeconds(clip.startSeconds)}-${formatSeconds(clip.endSeconds)}s${clip.selected ? ' [selected]' : ''}`
			);
		}
		if (items.length > clips.length) {
			lines.push(`  ...and ${items.length - clips.length} more clips not listed.`);
		}
	}
	void clipCountOverride;
	return {
		text: lines.join('\n'),
		fps,
		selectedCount: selectedIds.length,
		clipCount: clips.length
	};
}
