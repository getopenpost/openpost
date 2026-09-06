/**
 * Caption import: SRT/VTT content becomes SubtitleCue entries in timeline
 * frames, attached to a dedicated subtitle item on the top track.
 */

import type { TimelineItem, SubtitleCue } from '../project/types';
import { m } from '$lib/paraglide/messages';
import { parseSrt } from './srt';
import type { SrtCue } from './srt';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { ensureOpenTrackForRange } from '../timeline/actions/track-placement';

export function srtToCues(cues: SrtCue[], fps: number): SubtitleCue[] {
	return cues.map((cue) => ({
		id: crypto.randomUUID(),
		startFrame: Math.round(cue.startSeconds * fps),
		endFrame: Math.max(Math.round(cue.endSeconds * fps), Math.round(cue.startSeconds * fps) + 1),
		text: cue.text
	}));
}

export function addSubtitleItemFromSrt(content: string): string {
	// SAFETY: execute returns the action's own string id unchanged.
	return execute(
		'ADD_SUBTITLE_ITEM',
		() => {
			const parsed = parseSrt(content);
			if (parsed.length === 0) throw new Error('No cues found in the caption file');
			const fps = timelineStore.fps;
			const cues = srtToCues(parsed, fps);
			const end = cues.reduce((max, cue) => Math.max(max, cue.endFrame), 0);
			const label = m.video_editor_export_subtitles();
			const targetTrack = ensureOpenTrackForRange({
				kind: 'video',
				itemType: 'subtitle',
				from: 0,
				durationInFrames: end,
				label
			});
			const id = crypto.randomUUID();
			timelineStore._setItems([
				...timelineStore.items,
				{
					id,
					trackId: targetTrack.id,
					from: 0,
					durationInFrames: end,
					label,
					type: 'subtitle',
					captionSource: { type: 'subtitle-import', clipId: id, mediaId: 'captions' },
					cues
				} satisfies TimelineItem
			]);
			return id;
		} // SAFETY: execute returns the action's own string id unchanged.
	) as string;
}
