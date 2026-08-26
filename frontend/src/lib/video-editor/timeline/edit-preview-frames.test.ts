import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	buildRipplePanels,
	buildRollingPanels,
	buildSlidePanels,
	buildSlipPanels,
	createFittedVirtualItem,
	resolveVisualItem
} from './edit-preview-frames';
import { buildBaselineMap } from '../preview/edit-preview-store.svelte';

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 100,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 180,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

describe('edit preview frame mapping', () => {
	it('rolling shows OUT of left and IN of right at new cut', () => {
		const left = item({ id: 'left', from: 0, durationInFrames: 60, sourceStart: 0, sourceEnd: 60 });
		const right = item({
			id: 'right',
			from: 60,
			durationInFrames: 60,
			sourceStart: 60,
			sourceEnd: 120
		});
		const panels = buildRollingPanels([left, right], 'left', 'right', 30);
		expect(panels).toHaveLength(2);
		expect(panels[0]!.label).toBe('OUT');
		expect(panels[0]!.frame).toBe(59);
		expect(panels[0]!.isGap).toBe(false);
		expect(panels[1]!.label).toBe('IN');
		expect(panels[1]!.frame).toBe(60);
	});

	it('rolling marks GAP when clips are not adjacent', () => {
		const left = item({ id: 'left', from: 0, durationInFrames: 50 });
		const right = item({ id: 'right', from: 80, durationInFrames: 50 });
		const panels = buildRollingPanels([left, right], 'left', 'right', 30);
		expect(panels[0]!.frame).toBe(49);
		expect(panels[1]!.frame).toBe(80);
	});

	it('rolling resolves linked audio companion to visual', () => {
		const video = item({ id: 'video', trackId: 'v', linkedGroupId: 'g', type: 'video', from: 0 });
		const audio = item({ id: 'audio', trackId: 'a', linkedGroupId: 'g', type: 'audio', from: 0 });
		const right = item({ id: 'right', from: 60 });
		const panels = buildRollingPanels([video, audio, right], 'audio', 'right', 30);
		expect(panels[0]!.item?.id).toBe('video');
		expect(panels[0]!.frame).toBe(59);
	});

	it('rolling supports image and composition', () => {
		const image = item({ id: 'img', type: 'image', from: 0, durationInFrames: 30 });
		const comp = item({
			id: 'comp',
			type: 'composition',
			compositionId: 'c1',
			from: 30,
			durationInFrames: 30
		});
		const panels = buildRollingPanels([image, comp], 'img', 'comp', 30);
		expect(panels[0]!.item?.type).toBe('image');
		expect(panels[1]!.item?.type).toBe('composition');
		expect(panels[0]!.frame).toBe(29);
		expect(panels[1]!.frame).toBe(30);
	});

	it('ripple end shows anchor OUT and next IN when adjacent, GAP when gapped', () => {
		const anchor = item({ id: 'anchor', from: 0, durationInFrames: 60 });
		const nextAdjacent = item({ id: 'next', from: 60, durationInFrames: 60 });
		const panelsAdjacent = buildRipplePanels([anchor, nextAdjacent], 'anchor', 'end', 30);
		expect(panelsAdjacent[0]!.frame).toBe(59);
		expect(panelsAdjacent[1]!.frame).toBe(60);
		expect(panelsAdjacent[1]!.isGap).toBe(false);

		const nextGapped = item({ id: 'next2', from: 100, durationInFrames: 60 });
		const panelsGapped = buildRipplePanels([anchor, nextGapped], 'anchor', 'end', 30);
		expect(panelsGapped[1]!.isGap).toBe(true);
		expect(panelsGapped[1]!.item).toBeNull();
	});

	it('ripple finds nearest next even when not exactly adjacent', () => {
		const anchor = item({ id: 'anchor', from: 0, durationInFrames: 60 });
		const far = item({ id: 'far', from: 120, durationInFrames: 30 });
		const panels = buildRipplePanels([anchor, far], 'anchor', 'end', 30);
		expect(panels[1]!.isGap).toBe(true);
	});

	it('ripple start shows prev OUT and anchor IN', () => {
		const prev = item({ id: 'prev', from: 0, durationInFrames: 60 });
		const anchor = item({ id: 'anchor', from: 60, durationInFrames: 60 });
		const panels = buildRipplePanels([prev, anchor], 'anchor', 'start', 30);
		expect(panels[0]!.frame).toBe(59);
		expect(panels[1]!.frame).toBe(60);
	});

	it('slip shows new IN/OUT plus baseline IN/OUT with correct timecodes', () => {
		const current = item({
			id: 'c',
			from: 100,
			durationInFrames: 60,
			sourceStart: 40,
			sourceEnd: 100
		});
		const baseline = {
			c: item({ id: 'c', from: 100, durationInFrames: 60, sourceStart: 30, sourceEnd: 90 })
		};
		const panels = buildSlipPanels([current], 'c', baseline, 30);
		expect(panels).toHaveLength(4);
		expect(panels[0]!.label).toBe('IN');
		expect(panels[0]!.isBaseline).toBe(false);
		expect(panels[0]!.frame).toBe(100);
		expect(panels[0]!.timecode).toBe('00:00:03:10');
		expect(panels[1]!.label).toBe('OUT');
		expect(panels[1]!.frame).toBe(159);
		expect(panels[2]!.isBaseline).toBe(true);
		expect(panels[2]!.frame).toBe(100);
		expect(panels[3]!.frame).toBe(159);
		expect(panels[2]!.item?.sourceStart).toBe(30);
		expect(panels[0]!.item?.sourceStart).toBe(40);
	});

	it('slip preserves speed, reverse, sourceFps in sourceSeconds', () => {
		const current = item({
			id: 'c',
			from: 0,
			durationInFrames: 30,
			sourceStart: 60,
			sourceEnd: 120,
			sourceFps: 60,
			speed: 2,
			isReversed: true
		});
		const baseline = {
			c: item({
				id: 'c',
				from: 0,
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 120,
				sourceFps: 60,
				speed: 2,
				isReversed: true
			})
		};
		const panels = buildSlipPanels([current], 'c', baseline, 30);
		expect(panels[0]!.sourceSeconds).not.toBeNull();
		expect(panels[0]!.sourceSeconds).toBeCloseTo(1.983, 2);
	});

	it('slip baseline is clone not mutated current', () => {
		const current = item({
			id: 'c',
			from: 50,
			durationInFrames: 60,
			sourceStart: 80,
			sourceEnd: 140
		});
		const baselineItem = item({
			id: 'c',
			from: 50,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60
		});
		const baseline = { c: baselineItem };
		const panels = buildSlipPanels([current], 'c', baseline, 30);
		expect(panels[0]!.item?.sourceStart).toBe(80);
		expect(panels[2]!.item?.sourceStart).toBe(0);
		expect(panels[0]!.item).not.toBe(baselineItem);
		expect(panels[2]!.item).toBe(baselineItem);
	});

	it('slide shows dynamic left OUT and right IN plus baseline corners', () => {
		const left = item({ id: 'left', from: 0, durationInFrames: 50, sourceStart: 0, sourceEnd: 50 });
		const center = item({ id: 'center', from: 50, durationInFrames: 60 });
		const right = item({
			id: 'right',
			from: 110,
			durationInFrames: 50,
			sourceStart: 200,
			sourceEnd: 250
		});
		const baseline = {
			left: item({ id: 'left', from: 0, durationInFrames: 40, sourceStart: 0, sourceEnd: 40 }),
			right: item({
				id: 'right',
				from: 100,
				durationInFrames: 60,
				sourceStart: 200,
				sourceEnd: 260
			}),
			center: center
		};
		const panels = buildSlidePanels([left, center, right], 'center', 'left', 'right', baseline, 30);
		expect(panels).toHaveLength(4);
		expect(panels[0]!.label).toBe('OUT');
		expect(panels[0]!.frame).toBe(49);
		expect(panels[0]!.isBaseline).toBe(false);
		expect(panels[1]!.label).toBe('IN');
		expect(panels[1]!.frame).toBe(110);
		expect(panels[2]!.isBaseline).toBe(true);
		expect(panels[2]!.frame).toBe(39);
		expect(panels[3]!.frame).toBe(100);
	});

	it('slide shows GAP when neighbor missing', () => {
		const center = item({ id: 'center', from: 50, durationInFrames: 60 });
		const panels = buildSlidePanels([center], 'center', null, null, {}, 30);
		expect(panels[0]!.isGap).toBe(true);
		expect(panels[1]!.isGap).toBe(true);
	});

	it('createFittedVirtualItem preserves source fields but fits transform', () => {
		const original = item({
			id: 'v',
			transform: { x: 100, y: 50, width: 400, height: 200, rotation: 15, opacity: 0.5 },
			sourceStart: 10,
			sourceEnd: 70,
			speed: 1.5,
			isReversed: true,
			compositionId: 'comp1'
		});
		const fitted = createFittedVirtualItem(original, 1920, 1080);
		expect(fitted.sourceStart).toBe(10);
		expect(fitted.sourceEnd).toBe(70);
		expect(fitted.speed).toBe(1.5);
		expect(fitted.isReversed).toBe(true);
		expect(fitted.compositionId).toBe('comp1');
		expect(fitted.transform?.x).toBe(0);
		expect(fitted.transform?.width).toBe(1920);
		expect(fitted.transform?.height).toBe(1080);
		expect(fitted.transform?.rotation).toBe(0);
	});

	it('resolveVisualItem prefers visual over audio in linked group', () => {
		const audio = item({ id: 'a', type: 'audio', linkedGroupId: 'g', from: 0 });
		const video = item({ id: 'v', type: 'video', linkedGroupId: 'g', from: 0 });
		expect(resolveVisualItem([audio, video], 'a')?.id).toBe('v');
		expect(resolveVisualItem([audio, video], 'v')?.id).toBe('v');
	});

	it('timecodes are timeline timecodes at 30fps', () => {
		const left = item({ id: 'left', from: 90, durationInFrames: 30 });
		const right = item({ id: 'right', from: 120, durationInFrames: 30 });
		const panels = buildRollingPanels([left, right], 'left', 'right', 30);
		expect(panels[0]!.timecode).toBe('00:00:03:29');
		expect(panels[1]!.timecode).toBe('00:00:04:00');
	});

	it('findNearestPrev prefers exact adjacent over older non-adjacent', () => {
		const older = item({ id: 'older', from: 0, durationInFrames: 30 });
		const adjacent = item({ id: 'adjacent', from: 30, durationInFrames: 30 });
		const anchor = item({ id: 'anchor', from: 60, durationInFrames: 30 });
		const panels = buildRipplePanels([older, adjacent, anchor], 'anchor', 'start', 30);
		expect(panels[0]!.item?.id).toBe('adjacent');
		expect(panels[0]!.frame).toBe(59);
		expect(panels[0]!.isGap).toBe(false);
	});

	it('buildBaselineMap includes linked visual members for audio anchors', () => {
		const video = item({ id: 'video', trackId: 'v', linkedGroupId: 'g', type: 'video', from: 0 });
		const audio = item({ id: 'audio', trackId: 'a', linkedGroupId: 'g', type: 'audio', from: 0 });
		const map = buildBaselineMap([video, audio], ['audio']);
		expect(map['audio']).toBeDefined();
		expect(map['video']).toBeDefined();
		expect(map['video']?.type).toBe('video');
	});

	it('slip with audio-linked anchor renders visual baseline', () => {
		const video = item({
			id: 'video',
			trackId: 'v',
			linkedGroupId: 'g',
			type: 'video',
			from: 0,
			sourceStart: 30,
			sourceEnd: 90
		});
		const audio = item({
			id: 'audio',
			trackId: 'a',
			linkedGroupId: 'g',
			type: 'audio',
			from: 0,
			sourceStart: 30,
			sourceEnd: 90
		});
		const currentVideo = item({
			id: 'video',
			trackId: 'v',
			linkedGroupId: 'g',
			type: 'video',
			from: 0,
			sourceStart: 40,
			sourceEnd: 100
		});
		const currentAudio = item({
			id: 'audio',
			trackId: 'a',
			linkedGroupId: 'g',
			type: 'audio',
			from: 0,
			sourceStart: 40,
			sourceEnd: 100
		});
		const baseline = buildBaselineMap([video, audio], ['audio']);
		const panels = buildSlipPanels([currentVideo, currentAudio], 'audio', baseline, 30);
		expect(panels[0]!.item?.id).toBe('video');
		expect(panels[0]!.item?.sourceStart).toBe(40);
		expect(panels[2]!.item?.id).toBe('video');
		expect(panels[2]!.item?.sourceStart).toBe(30);
	});

	it('slide with audio-linked neighbors renders visual baselines', () => {
		const leftVideo = item({
			id: 'leftVideo',
			trackId: 'v',
			linkedGroupId: 'lg',
			type: 'video',
			from: 0,
			durationInFrames: 50,
			sourceStart: 0,
			sourceEnd: 50
		});
		const leftAudio = item({
			id: 'leftAudio',
			trackId: 'a',
			linkedGroupId: 'lg',
			type: 'audio',
			from: 0,
			durationInFrames: 50,
			sourceStart: 0,
			sourceEnd: 50
		});
		const center = item({ id: 'center', from: 50, durationInFrames: 60 });
		const rightVideo = item({
			id: 'rightVideo',
			trackId: 'v',
			linkedGroupId: 'rg',
			type: 'video',
			from: 110,
			durationInFrames: 50,
			sourceStart: 100,
			sourceEnd: 150
		});
		const rightAudio = item({
			id: 'rightAudio',
			trackId: 'a',
			linkedGroupId: 'rg',
			type: 'audio',
			from: 110,
			durationInFrames: 50,
			sourceStart: 100,
			sourceEnd: 150
		});
		const baseline = buildBaselineMap(
			[leftVideo, leftAudio, rightVideo, rightAudio, center],
			['leftAudio', 'rightAudio']
		);
		const panels = buildSlidePanels(
			[leftVideo, leftAudio, center, rightVideo, rightAudio],
			'center',
			'leftAudio',
			'rightAudio',
			baseline,
			30
		);
		expect(panels[0]!.item?.id).toBe('leftVideo');
		expect(panels[2]!.item?.id).toBe('leftVideo');
		expect(panels[1]!.item?.id).toBe('rightVideo');
		expect(panels[3]!.item?.id).toBe('rightVideo');
	});
});
