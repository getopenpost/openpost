import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, migrateProjectDocument } from './defaults';
import { unsupportedProjectSchemaVersion } from './project-editability';
import type { Project, ProjectTimeline, TimelineItem, TimelineTransition } from './types';

function freeCutProject(): Project {
	const star: TimelineItem = {
		id: 'star',
		trackId: 'visuals',
		from: 0,
		durationInFrames: 60,
		label: 'Star',
		type: 'shape',
		shapeType: 'star',
		volume: 0
	};
	Object.assign(star, {
		direction: 'up',
		points: 7,
		innerRadius: 0.4,
		effects: [
			{
				id: 'grade',
				enabled: true,
				effect: {
					type: 'gpu-effect',
					gpuEffectType: 'gpu-contrast',
					params: { amount: 1.2 }
				}
			}
		]
	});

	const lottie: TimelineItem = {
		id: 'lottie',
		trackId: 'visuals',
		from: 60,
		durationInFrames: 60,
		label: 'Logo',
		type: 'lottie'
	};
	Object.assign(lottie, {
		frameRate: 30,
		totalFrames: 90,
		loop: false,
		reversed: true,
		segmentStart: 10,
		segmentEnd: 70
	});

	const captions: TimelineItem = {
		id: 'captions',
		trackId: 'visuals',
		from: 0,
		durationInFrames: 120,
		label: 'Captions',
		type: 'subtitle'
	};
	Object.assign(captions, {
		source: { type: 'transcript', mediaId: 'media', clipId: 'star' },
		cues: [{ id: 'cue', startSeconds: 0.5, endSeconds: 1.25, text: 'Hello' }]
	});

	const transition: TimelineTransition = {
		id: 'transition',
		type: 'crossfade',
		presentation: 'fade',
		timing: 'linear',
		fromItemId: 'star',
		toItemId: 'lottie',
		durationInFrames: 12
	};
	Object.assign(transition, {
		leftClipId: 'star',
		rightClipId: 'lottie',
		trackId: 'visuals'
	});
	Reflect.deleteProperty(transition, 'fromItemId');
	Reflect.deleteProperty(transition, 'toItemId');

	const timeline: ProjectTimeline = {
		tracks: [
			{
				id: 'visuals',
				name: 'Visuals',
				kind: 'video',
				height: 80,
				locked: false,
				visible: true,
				muted: false,
				solo: false,
				volume: 0,
				order: 0
			}
		],
		items: [star, lottie, captions],
		transitions: [transition],
		compositions: [
			{
				id: 'motion',
				name: 'Motion',
				editorKind: 'composite-2d',
				items: [],
				tracks: [],
				transitions: [],
				fps: 60,
				width: 1080,
				height: 1080,
				durationInFrames: 60
			}
		]
	};
	Object.assign(timeline, {
		masterBusDb: -6,
		keyframes: [
			{
				itemId: 'star',
				animationVersion: 2,
				properties: [
					{
						property: 'x',
						keyframes: [
							{
								id: 'x0',
								frame: 0,
								value: 10,
								easing: 'linear',
								source: {
									applicationId: 'freecut-preset',
									kind: 'built-in-preset',
									presetId: 'slide-in-left',
									presetName: 'Slide left'
								}
							},
							{
								id: 'x1',
								frame: 30,
								value: 100,
								easing: 'ease-out',
								source: {
									applicationId: 'freecut-preset',
									kind: 'built-in-preset',
									presetId: 'slide-in-left',
									presetName: 'Slide left'
								}
							}
						]
					},
					{
						property: 'volume',
						keyframes: [
							{ id: 'v0', frame: 0, value: -6, easing: 'linear' },
							{ id: 'v1', frame: 30, value: 0, easing: 'linear' }
						]
					}
				]
			}
		]
	});

	return {
		id: 'freecut-project',
		name: 'FreeCut project',
		description: '',
		createdAt: 1,
		updatedAt: 2,
		duration: 120,
		schemaVersion: 15,
		metadata: { width: 1920, height: 1080, fps: 60, backgroundColor: '#000000' },
		timeline
	};
}

describe('FreeCut project compatibility', () => {
	it('converts schema 15 without losing editor behavior', () => {
		const result = migrateProjectDocument(freeCutProject());
		const timeline = result.project.timeline!;
		const star = timeline.items.find((item) => item.id === 'star')!;
		const lottie = timeline.items.find((item) => item.id === 'lottie')!;
		const captions = timeline.items.find((item) => item.id === 'captions')!;

		expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(result.project.schemaFamily).toBe('openpost');
		expect(result.migrated).toBe(true);
		expect(result.warnings.some((warning) => warning.code === 'FREECUT_SCHEMA_IMPORTED')).toBe(
			true
		);
		expect(timeline.masterVolumeDb).toBe(-6);
		expect(timeline.tracks[0]?.volume).toBe(1);
		expect(star).toMatchObject({
			shapeDirection: 'up',
			shapePoints: 7,
			shapeInnerRadius: 0.4,
			volume: 1,
			animationVersion: 2
		});
		expect(star.effects).toEqual([
			{
				id: 'grade',
				enabled: true,
				type: 'gpu',
				effectId: 'gpu-contrast',
				params: { amount: 1.2 }
			}
		]);
		expect(star.keyframes?.x).toMatchObject({
			frames: [0, 30],
			values: [10, 100],
			ids: ['x0', 'x1'],
			easings: ['linear', 'ease-out'],
			sources: [
				expect.objectContaining({ applicationId: 'freecut-preset' }),
				expect.objectContaining({ applicationId: 'freecut-preset' })
			]
		});
		expect(star.keyframes?.volume?.values).toEqual([expect.closeTo(0.501187, 5), 1]);
		expect(lottie).toMatchObject({
			lottieFrameRate: 30,
			lottieTotalFrames: 90,
			lottieLoop: false,
			lottieReversed: true,
			lottieSegmentStart: 10,
			lottieSegmentEnd: 70
		});
		expect(captions.captionSource).toMatchObject({
			type: 'transcript',
			mediaId: 'media',
			clipId: 'star'
		});
		expect(captions.cues).toEqual([{ id: 'cue', startFrame: 30, endFrame: 75, text: 'Hello' }]);
		expect(timeline.transitions).toEqual([
			expect.objectContaining({ fromItemId: 'star', toItemId: 'lottie' })
		]);
		expect(timeline.compositions?.[0]?.editorKind).toBe('composite-2d');
		expect(unsupportedProjectSchemaVersion(result.project)).toBeNull();
	});

	it('keeps unknown future OpenPost projects out of the writable editor', () => {
		const project = freeCutProject();
		project.schemaFamily = 'openpost';
		project.schemaVersion = 999;

		const result = migrateProjectDocument(project);

		expect(result.warnings.some((warning) => warning.code === 'FUTURE_SCHEMA')).toBe(true);
		expect(unsupportedProjectSchemaVersion(result.project)).toBe(999);
	});
});
