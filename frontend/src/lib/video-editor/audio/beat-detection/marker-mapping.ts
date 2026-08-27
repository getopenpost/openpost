import type { TimelineMarker } from '$lib/video-editor/project/types';
import { BEAT_MARKER_COLOR, DOWNBEAT_MARKER_COLOR } from './types';
import type { Beat } from './types';
import { BeatAnalyzer } from './analyzer';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { sourceSecondsToTimelineFrame } from '$lib/video-editor/timeline/utils/media-item-frames';

export interface BeatMarkerOptions {
	fps: number;
	item?: TimelineItem | null;
	beatsPerBar?: number;
	dedupToleranceFrames?: number;
}

export function beatsToMarkers(
	beats: Beat[],
	downbeats: number[],
	options: BeatMarkerOptions
): TimelineMarker[] {
	const fps = options.fps;
	const beatsPerBar = options.beatsPerBar ?? 4;
	const tolerance = options.dedupToleranceFrames ?? 1;
	const downbeatSet = new Set(downbeats.map((t) => Math.round(t * 1000) / 1000));

	// Group beats per bar index to number them deterministically
	const sorted = [...beats].sort((a, b) => a.time - b.time);

	const markers: TimelineMarker[] = [];
	const seenFrames = new Set<number>();

	for (const beat of sorted) {
		const isDownbeat = downbeatSet.has(Math.round(beat.time * 1000) / 1000);
		// If analyzer produced downbeats as subset, also treat every 4th as downbeat
		const impliedDownbeat = !isDownbeat && beat.index % beatsPerBar === 0;
		const effectiveDownbeat = isDownbeat || impliedDownbeat;

		const frame = options.item
			? sourceSecondsToTimelineFrame(options.item, beat.time, fps)
			: BeatAnalyzer.mapBeatToFrame(beat.time, fps);

		// Dedup within tolerance
		let duplicate = false;
		for (let delta = -tolerance; delta <= tolerance; delta++) {
			if (seenFrames.has(frame + delta)) {
				duplicate = true;
				break;
			}
		}
		if (duplicate) continue;
		seenFrames.add(frame);

		const bar = Math.floor(beat.index / beatsPerBar) + 1;
		const beatInBar = (beat.index % beatsPerBar) + 1;

		markers.push({
			id: crypto.randomUUID(),
			frame,
			label: effectiveDownbeat ? `Downbeat ${bar}` : `Beat ${beatInBar}`,
			color: effectiveDownbeat ? DOWNBEAT_MARKER_COLOR : BEAT_MARKER_COLOR
		});
	}

	return markers.sort((a, b) => a.frame - b.frame);
}

export function dedupeAgainstExisting(
	candidates: TimelineMarker[],
	existing: readonly TimelineMarker[],
	tolerance = 1
): TimelineMarker[] {
	const existingFrames = new Set(existing.map((m) => m.frame));
	const filtered: TimelineMarker[] = [];
	const seen = new Set<number>();

	for (const candidate of candidates) {
		let collides = false;
		for (let delta = -tolerance; delta <= tolerance; delta++) {
			if (existingFrames.has(candidate.frame + delta) || seen.has(candidate.frame + delta)) {
				collides = true;
				break;
			}
		}
		if (collides) continue;
		seen.add(candidate.frame);
		filtered.push(candidate);
	}
	return filtered;
}
