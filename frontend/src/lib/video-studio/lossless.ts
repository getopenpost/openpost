import {
	defaultVideoPresentation,
	derivePrimarySequence,
	isPrimarySequenceClip,
	type PrimarySequenceClip,
	type VideoProjectDocumentV1
} from '@openpost/video-project';

export interface QuickCutSegment {
	clip_id: string;
	source_id: string;
	source_start_us: number;
	source_end_us: number;
	timeline_start_us: number;
	timeline_end_us: number;
}

export interface QuickCutCompatibility {
	compatible: boolean;
	reason?:
		| 'empty'
		| 'gap'
		| 'multiple-sources'
		| 'composition-edits'
		| 'clip-edits'
		| 'unsupported-source';
	segments: QuickCutSegment[];
}

export function quickCutOutputPreference(project: VideoProjectDocumentV1): {
	format: 'mp4' | 'webm';
	mimeType: 'video/mp4' | 'video/webm';
	fileName: string;
} {
	const compatibility = quickCutCompatibility(project);
	const source = project.sources[compatibility.segments[0]?.source_id ?? ''];
	const webm =
		source?.mime_type.toLowerCase().includes('webm') ||
		source?.video_codec === 'vp8' ||
		source?.video_codec === 'vp9';
	const format = webm ? 'webm' : 'mp4';
	return {
		format,
		mimeType: webm ? 'video/webm' : 'video/mp4',
		fileName: `${safeQuickCutFileName(project.title)}-quick-cut.${format}`
	};
}

export function quickCutCompatibility(project: VideoProjectDocumentV1): QuickCutCompatibility {
	const derived = derivePrimarySequence(project);
	if (!derived.length) return { compatible: false, reason: 'empty', segments: [] };
	if (derived.some((item) => item.kind === 'gap')) {
		return { compatible: false, reason: 'gap', segments: [] };
	}
	const clips = project.primary_sequence.filter(isPrimarySequenceClip);
	const sourceIDs = new Set(clips.map((clip) => clip.source_id));
	if (sourceIDs.size !== 1) {
		return { compatible: false, reason: 'multiple-sources', segments: [] };
	}
	const source = project.sources[clips[0]?.source_id ?? ''];
	if (
		!source ||
		(source.kind !== 'video' && source.kind !== 'recording-screen') ||
		!source.video_codec
	) {
		return { compatible: false, reason: 'unsupported-source', segments: [] };
	}
	if (
		project.visual_tracks.some((track) => track.items.length > 0) ||
		project.audio_tracks.some((track) => track.items.length > 0) ||
		project.caption_tracks.some((track) => track.cues.length > 0)
	) {
		return { compatible: false, reason: 'composition-edits', segments: [] };
	}
	if (clips.some((clip) => !isStreamCopyClip(clip))) {
		return { compatible: false, reason: 'clip-edits', segments: [] };
	}
	if (
		clips.some((clip, index) => index > 0 && clip.source_in_us < clips[index - 1]!.source_out_us)
	) {
		return { compatible: false, reason: 'clip-edits', segments: [] };
	}
	return {
		compatible: true,
		segments: derived.map((item) => {
			const clip = project.primary_sequence[item.index] as PrimarySequenceClip;
			return {
				clip_id: clip.id,
				source_id: clip.source_id,
				source_start_us: clip.source_in_us,
				source_end_us: clip.source_out_us,
				timeline_start_us: item.timeline_start_us,
				timeline_end_us: item.timeline_end_us
			};
		})
	};
}

export function nearestKeyframeUS(keyframesUS: number[], timestampUS: number): number | null {
	if (!keyframesUS.length) return null;
	let low = 0;
	let high = keyframesUS.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const value = keyframesUS[middle]!;
		if (value === timestampUS) return value;
		if (value < timestampUS) low = middle + 1;
		else high = middle - 1;
	}
	const before = keyframesUS[Math.max(0, high)];
	const after = keyframesUS[Math.min(keyframesUS.length - 1, low)];
	if (before === undefined) return after ?? null;
	if (after === undefined) return before;
	return timestampUS - before <= after - timestampUS ? before : after;
}

export function isKeyframeAligned(
	keyframesUS: number[],
	timestampUS: number,
	toleranceUS = 2_000
): boolean {
	return resolveKeyframeAlignment(keyframesUS, timestampUS, toleranceUS) !== null;
}

export interface KeyframeAlignment {
	timestamp_us: number;
	delta_us: number;
}

/** Returns the canonical indexed packet timestamp when a boundary is aligned. */
export function resolveKeyframeAlignment(
	keyframesUS: number[],
	timestampUS: number,
	toleranceUS = 2_000
): KeyframeAlignment | null {
	const nearest = nearestKeyframeUS(keyframesUS, timestampUS);
	if (nearest === null || Math.abs(nearest - timestampUS) > toleranceUS) return null;
	return { timestamp_us: nearest, delta_us: nearest - timestampUS };
}

function isStreamCopyClip(clip: PrimarySequenceClip): boolean {
	if (
		clip.mode !== 'source' ||
		clip.speed !== 1 ||
		clip.effects.length > 0 ||
		clip.transition_in ||
		clip.transition_out ||
		clip.variant_overrides
	) {
		return false;
	}
	if (
		clip.audio.muted ||
		clip.audio.gain_db !== 0 ||
		clip.audio.fade_in_us !== 0 ||
		clip.audio.fade_out_us !== 0 ||
		clip.audio.duck_others ||
		clip.audio.gain_db_keyframes?.length
	) {
		return false;
	}
	return JSON.stringify(clip.video) === JSON.stringify(defaultVideoPresentation());
}

function safeQuickCutFileName(value: string): string {
	return (
		value
			.trim()
			.replace(/[^a-z0-9_-]+/giu, '-')
			.replace(/^-+|-+$/gu, '') || 'video'
	);
}
