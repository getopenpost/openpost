import { describe, expect, it } from 'vitest';
import {
	createBlankVideoProject,
	defaultClipAudio,
	defaultVideoPresentation,
	isPrimarySequenceClip,
	type PrimarySequenceClip,
	type VideoProjectDocumentV1
} from '@openpost/video-project';
import {
	isKeyframeAligned,
	nearestKeyframeUS,
	quickCutCompatibility,
	resolveKeyframeAlignment
} from './lossless';

function quickProject() {
	const project = createBlankVideoProject('Fast cut', 'quick-cut');
	project.sources.source = {
		id: 'source',
		kind: 'video',
		locator: { type: 'local-opfs', path: 'source.mp4' },
		original_name: 'source.mp4',
		mime_type: 'video/mp4',
		size_bytes: 100,
		duration_us: 10_000_000,
		width: 1920,
		height: 1080,
		rotation: 0,
		video_codec: 'avc',
		audio_codec: 'aac'
	};
	project.primary_sequence.push({
		id: 'clip',
		kind: 'clip',
		source_id: 'source',
		mode: 'source',
		source_in_us: 0,
		source_out_us: 10_000_000,
		speed: 1,
		video: defaultVideoPresentation(),
		audio: defaultClipAudio(),
		effects: []
	});
	return project;
}

function firstClip(project: VideoProjectDocumentV1): PrimarySequenceClip {
	const item = project.primary_sequence[0];
	if (!item || !isPrimarySequenceClip(item)) throw new Error('Expected the first timeline clip.');
	return item;
}

describe('quick-cut stream-copy eligibility', () => {
	it('accepts one unmodified source split into kept ranges', () => {
		const project = quickProject();
		const clip = firstClip(project);
		clip.source_out_us = 4_000_000;
		project.primary_sequence.push({
			...structuredClone(clip),
			id: 'clip-2',
			source_in_us: 6_000_000,
			source_out_us: 10_000_000
		});
		expect(quickCutCompatibility(project)).toMatchObject({
			compatible: true,
			segments: [
				{ source_start_us: 0, source_end_us: 4_000_000 },
				{ source_start_us: 6_000_000, source_end_us: 10_000_000 }
			]
		});
	});

	it('falls back when a composition edit changes pixels', () => {
		const project = quickProject();
		firstClip(project).video.scale = 1.2;
		expect(quickCutCompatibility(project)).toMatchObject({
			compatible: false,
			reason: 'clip-edits'
		});
	});

	it('falls back when source ranges overlap or run out of source order', () => {
		const project = quickProject();
		const clip = firstClip(project);
		clip.source_out_us = 7_000_000;
		project.primary_sequence.push({
			...structuredClone(clip),
			id: 'clip-2',
			source_in_us: 4_000_000,
			source_out_us: 10_000_000
		});
		expect(quickCutCompatibility(project)).toMatchObject({
			compatible: false,
			reason: 'clip-edits'
		});
	});

	it('finds and verifies the nearest indexed keyframe', () => {
		const keyframes = [0, 2_000_000, 4_000_000];
		expect(nearestKeyframeUS(keyframes, 2_800_000)).toBe(2_000_000);
		expect(nearestKeyframeUS(keyframes, 3_200_000)).toBe(4_000_000);
		expect(isKeyframeAligned(keyframes, 2_001_000)).toBe(true);
		expect(isKeyframeAligned(keyframes, 2_010_000)).toBe(false);
		expect(resolveKeyframeAlignment(keyframes, 2_001_000)).toEqual({
			timestamp_us: 2_000_000,
			delta_us: -1_000
		});
		expect(resolveKeyframeAlignment(keyframes, 2_010_000)).toBeNull();
	});
});
