import type { MotionModifierChannel, MotionModifierType } from '$lib/video-editor/project/types';
import type { MotionThumbnail } from './motion-presets';

export interface MotionModulator {
	id: MotionModifierType;
	labelKey: string;
	properties: MotionModifierChannel[];
	thumbnail: MotionThumbnail;
}

export const MOTION_MODULATORS: MotionModulator[] = [
	{
		id: 'float-drift',
		labelKey: 'floatDrift',
		properties: ['x', 'y', 'rotation'],
		thumbnail: { kind: 'drift' }
	},
	{
		id: 'sway',
		labelKey: 'sway',
		properties: ['rotation'],
		thumbnail: { kind: 'wobble' }
	},
	{
		id: 'breath-pulse',
		labelKey: 'breathPulse',
		properties: ['scaleX', 'scaleY', 'opacity'],
		thumbnail: { kind: 'pulse' }
	},
	{
		id: 'spin',
		labelKey: 'spin',
		properties: ['rotation'],
		thumbnail: { kind: 'spin' }
	},
	{
		id: 'micro-shake',
		labelKey: 'microShake',
		properties: ['x', 'y', 'rotation'],
		thumbnail: { kind: 'micro-shake' }
	}
];
