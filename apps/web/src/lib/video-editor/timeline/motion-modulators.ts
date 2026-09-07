import type { MotionModifierChannel, MotionModifierType } from '$lib/video-editor/project/types';
import type { MotionThumbnail } from './motion-presets';

export interface MotionModulator {
	id: MotionModifierType;
	labelKey: string;
	properties: MotionModifierChannel[];
	/** True when it rescales the item box (gated for text clips; ported from FreeCut (MIT)). */
	scalesBox?: boolean;
	thumbnail: MotionThumbnail;
}

/** Whether a modulator rescales the clip box (reflows text instead of scaling it). */
export function motionModulatorScalesBox(modulator: MotionModulator): boolean {
	return modulator.scalesBox === true;
}

export const MOTION_MODULATORS: MotionModulator[] = [
	{
		id: 'float-drift',
		labelKey: 'floatDrift',
		properties: ['x', 'y', 'rotation'],
		thumbnail: { kind: 'drift', loop: true }
	},
	{
		id: 'sway',
		labelKey: 'sway',
		properties: ['rotation'],
		thumbnail: { kind: 'wobble', loop: true }
	},
	{
		// Intentionally NOT scalesBox: unlike FreeCut's width/height original, this port
		// drives transform scaleX/scaleY, which scales the rendered glyph without
		// reflowing text. The scalesBox gate stays dormant until a box-scaling
		// modulator ships.
		id: 'breath-pulse',
		labelKey: 'breathPulse',
		properties: ['scaleX', 'scaleY', 'opacity'],
		thumbnail: { kind: 'pulse', loop: true }
	},
	{
		id: 'spin',
		labelKey: 'spin',
		properties: ['rotation'],
		thumbnail: { kind: 'spin', loop: true }
	},
	{
		id: 'micro-shake',
		labelKey: 'microShake',
		properties: ['x', 'y', 'rotation'],
		thumbnail: { kind: 'micro-shake', loop: true }
	}
];
