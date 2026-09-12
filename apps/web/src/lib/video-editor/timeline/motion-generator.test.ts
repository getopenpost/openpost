import { describe, expect, it } from 'vitest';
import type {
	MotionPreset,
	MotionPresetBuildContext
} from '$lib/video-editor/timeline/motion-presets';
import {
	applyMotionGeneratorSettings,
	DEFAULT_MOTION_GENERATOR_SETTINGS
} from '$lib/video-editor/timeline/motion-generator';

const preset: MotionPreset = {
	id: 'pulse',
	category: 'emphasis',
	labelKey: 'pulse',
	thumbnail: { kind: 'pulse', loop: true },
	properties: ['scaleX', 'scaleY', 'opacity'],
	build: () => []
};

const context: MotionPresetBuildContext = {
	anchor: {
		x: 0,
		y: 0,
		width: 1920,
		height: 1080,
		scaleX: 1,
		scaleY: 1,
		rotation: 0,
		opacity: 0.5
	},
	durationInFrames: 60,
	fps: 30,
	frameWidth: 1920,
	frameHeight: 1080
};

describe('applyMotionGeneratorSettings clamps', () => {
	it('clamps opacity intensity scaling to 0..1', () => {
		const result = applyMotionGeneratorSettings(
			preset,
			[{ property: 'opacity', frame: 0, value: 5, easing: 'linear' }],
			context,
			{ ...DEFAULT_MOTION_GENERATOR_SETTINGS, intensityScale: 2 }
		);
		expect(result[0]?.value).toBe(1);
	});

	it('clamps scale intensity scaling to a positive minimum', () => {
		const result = applyMotionGeneratorSettings(
			preset,
			[{ property: 'scaleX', frame: 0, value: -3, easing: 'linear' }],
			context,
			{ ...DEFAULT_MOTION_GENERATOR_SETTINGS, intensityScale: 2 }
		);
		expect(result[0]?.value).toBe(0.01);
	});

	it('leaves unbounded properties unclamped', () => {
		const result = applyMotionGeneratorSettings(
			preset,
			[{ property: 'x', frame: 0, value: 400, easing: 'linear' }],
			context,
			{ ...DEFAULT_MOTION_GENERATOR_SETTINGS, intensityScale: 2 }
		);
		expect(result[0]?.value).toBe(800);
	});
});
