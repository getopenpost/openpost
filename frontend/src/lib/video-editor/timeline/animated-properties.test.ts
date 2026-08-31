/**
 * Ported from FreeCut (MIT) - animatable-properties and animated item resolver tests.
 */
import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { getAnimatablePropertiesForItem, resolveAnimatedItemAt } from './animated-properties';
import { buildEffectKeyframeProperty } from '../effects/effect-keyframes';

function item(type: TimelineItem['type']): TimelineItem {
	return {
		id: 'item',
		trackId: 'track',
		from: 100,
		durationInFrames: 60,
		label: '',
		type
	};
}

describe('animatable properties', () => {
	it('exposes transform, crop, and volume lanes for video', () => {
		expect(getAnimatablePropertiesForItem(item('video'))).toEqual([
			'x',
			'y',
			'width',
			'height',
			'scaleX',
			'scaleY',
			'anchorX',
			'anchorY',
			'rotation',
			'opacity',
			'cornerRadius',
			'cropLeft',
			'cropRight',
			'cropTop',
			'cropBottom',
			'cropSoftness',
			'volume'
		]);
	});

	it('exposes typography lanes only on text items', () => {
		const properties = getAnimatablePropertiesForItem(item('text'));
		expect(properties).toContain('textStyleScale');
		expect(properties).toContain('fontSize');
		expect(properties).toContain('textShadowBlur');
		expect(properties).toContain('strokeWidth');
		expect(properties).not.toContain('volume');
		expect(properties).not.toContain('cropLeft');
	});

	it('exposes six scalar lanes for every path vertex', () => {
		const path: TimelineItem = {
			...item('shape'),
			shapeType: 'path',
			pathVertices: [
				{
					position: [0.25, 0.5],
					inHandle: [-0.1, 0],
					outHandle: [0.1, 0],
					tangentMode: 'continuous'
				}
			]
		};
		expect(getAnimatablePropertiesForItem(path)).toContain('pathVertex:0:outY');
	});

	it('exposes trim and taper lanes for shapes', () => {
		const properties = getAnimatablePropertiesForItem(item('shape'));
		expect(properties).toEqual(
			expect.arrayContaining([
				'strokeWidth',
				'trimPathStart',
				'trimPathEnd',
				'trimPathOffset',
				'taperStartWidth',
				'taperEndWidth',
				'taperStartLength',
				'taperEndLength'
			])
		);
	});
});

describe('resolveAnimatedItemAt', () => {
	it('evaluates deterministic live motion only when render context is available', () => {
		const video: TimelineItem = {
			...item('video'),
			transform: { x: 100, y: 200, width: 400, height: 300, rotation: 0, opacity: 1 },
			motionModifiers: [
				{
					id: 'sway',
					type: 'sway',
					enabled: true,
					amplitude: 1,
					frequency: 0.5,
					phaseFrames: 0,
					seed: 1
				}
			]
		};
		expect(resolveAnimatedItemAt(video, 115).transform?.rotation).toBe(0);
		expect(
			resolveAnimatedItemAt(video, 115, {
				fps: 30,
				frameWidth: 1920,
				frameHeight: 1080
			}).transform?.rotation
		).toBeCloseTo(4, 6);
	});

	it('resolves nested transform, crop, audio, and text fields at one absolute frame', () => {
		const video: TimelineItem = {
			...item('video'),
			sourceWidth: 1000,
			sourceHeight: 500,
			transform: { x: 10, opacity: 1 },
			crop: { top: 0, right: 0, bottom: 0, left: 0 },
			keyframes: {
				x: { frames: [0, 30], values: [10, 70] },
				opacity: { frames: [0, 30], values: [1, 0] },
				cropLeft: { frames: [0, 30], values: [0, 100] }
			}
		};
		const text: TimelineItem = {
			...item('text'),
			textStyleScale: 1,
			fontSize: 40,
			textShadow: { blur: 0, color: '#000000', offsetX: 0, offsetY: 0 },
			keyframes: {
				textStyleScale: { frames: [0, 30], values: [1, 2] },
				fontSize: { frames: [0, 30], values: [40, 80] },
				textShadowBlur: { frames: [0, 30], values: [0, 20] }
			}
		};

		const resolvedVideo = resolveAnimatedItemAt(video, 115);
		const resolvedText = resolveAnimatedItemAt(text, 115);

		expect(resolvedVideo.transform).toMatchObject({ x: 40, opacity: 0.5 });
		expect(resolvedVideo.crop?.left).toBe(0.05);
		expect(resolvedText.textStyleScale).toBe(1.5);
		expect(resolvedText.fontSize).toBe(60);
		expect(resolvedText.textShadow).toMatchObject({ blur: 10, color: '#000000' });
		expect(video.transform).toMatchObject({ x: 10, opacity: 1 });
	});

	it('uses coupled spatial position ahead of stale scalar X/Y tracks', () => {
		const video: TimelineItem = {
			...item('video'),
			transform: { x: 999, y: 999 },
			keyframes: {
				x: { frames: [0, 30], values: [-500, -500] },
				y: { frames: [0, 30], values: [-500, -500] }
			},
			vectorKeyframes: {
				position: [
					{
						id: 'start',
						frame: 0,
						value: { x: 0, y: 0 },
						easing: 'linear',
						spatial: {
							inTangent: { x: 0, y: -100 },
							outTangent: { x: 0, y: 100 }
						}
					},
					{
						id: 'end',
						frame: 30,
						value: { x: 60, y: 0 },
						easing: 'linear',
						spatial: {
							inTangent: { x: 0, y: 100 },
							outTangent: { x: 0, y: -100 }
						}
					}
				]
			}
		};

		expect(resolveAnimatedItemAt(video, 115).transform).toMatchObject({ x: 30, y: 75 });
	});

	it('resolves coupled percentage scale and pixel anchor lanes', () => {
		const video: TimelineItem = {
			...item('video'),
			transform: { width: 400, height: 200, anchorX: 200, anchorY: 100 },
			vectorKeyframes: {
				scale: [
					{ id: 'scale-a', frame: 0, value: { x: 100, y: 100 }, easing: 'linear' },
					{ id: 'scale-b', frame: 30, value: { x: 200, y: 50 }, easing: 'linear' }
				],
				anchor: [
					{ id: 'anchor-a', frame: 0, value: { x: 200, y: 100 }, easing: 'linear' },
					{ id: 'anchor-b', frame: 30, value: { x: 300, y: 50 }, easing: 'linear' }
				]
			}
		};

		expect(resolveAnimatedItemAt(video, 115).transform).toMatchObject({
			width: 600,
			height: 150,
			anchorX: 250,
			anchorY: 75
		});
	});

	it('interpolates path positions and handles without changing topology', () => {
		const path: TimelineItem = {
			...item('shape'),
			shapeType: 'path',
			pathVertices: [
				{
					position: [0, 0],
					inHandle: [0, 0],
					outHandle: [0.25, 0],
					tangentMode: 'broken'
				},
				{
					position: [1, 1],
					inHandle: [-0.25, 0],
					outHandle: [0, 0],
					tangentMode: 'broken'
				}
			],
			keyframes: {
				'pathVertex:0:positionX': { frames: [0, 30], values: [0, 1] },
				'pathVertex:1:inY': { frames: [0, 30], values: [0, -0.5] }
			}
		};

		const resolved = resolveAnimatedItemAt(path, 115);
		expect(resolved.pathVertices?.[0]?.position).toEqual([0.5, 0]);
		expect(resolved.pathVertices?.[1]?.inHandle).toEqual([-0.25, -0.25]);
		expect(resolved.pathVertices?.[0]?.tangentMode).toBe('broken');
		expect(path.pathVertices?.[0]?.position).toEqual([0, 0]);
	});

	it('interpolates trim paths and tapers for preview and export resolution', () => {
		const shape: TimelineItem = {
			...item('shape'),
			shapeType: 'path',
			trimPathEnd: 0,
			taperStartWidth: 100,
			keyframes: {
				trimPathEnd: { frames: [0, 30], values: [0, 100] },
				taperStartWidth: { frames: [0, 30], values: [100, 0] }
			}
		};

		const resolved = resolveAnimatedItemAt(shape, 115);
		expect(resolved.trimPathEnd).toBe(50);
		expect(resolved.taperStartWidth).toBe(50);
		expect(shape.trimPathEnd).toBe(0);
	});

	it('resolves effect params through the same item used by preview and export', () => {
		const property = buildEffectKeyframeProperty('gpu-contrast', 'contrast', 'amount');
		const video: TimelineItem = {
			...item('video'),
			effects: [
				{
					id: 'contrast',
					type: 'gpu',
					effectId: 'gpu-contrast',
					enabled: true,
					params: { amount: 1 }
				}
			],
			keyframes: { [property]: { frames: [0, 30], values: [1, 3] } }
		};
		const properties = getAnimatablePropertiesForItem(video);
		expect(properties).toContain(property);
		const resolved = resolveAnimatedItemAt(video, 115);
		expect(resolved.effects?.[0]).toMatchObject({ params: { amount: 2 } });
	});
});
