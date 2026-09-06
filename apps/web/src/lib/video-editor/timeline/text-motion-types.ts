import type {
	TextMotionEffectBase,
	TextMotionPresetId,
	TextMotionSlot,
	TextMotionUnit
} from '../project/types';

export interface GlyphMotionState {
	dx: number;
	dy: number;
	scale: number;
	rotation: number;
	alpha: number;
	soften: number;
}

export interface TextMotionChannelContext {
	unitIndex: number;
	unitCount: number;
	fontSize: number;
	boxWidth: number;
	boxHeight: number;
	intensity: number;
	seed: number;
}

export interface TextMotionPreset {
	id: TextMotionPresetId;
	slot: TextMotionSlot;
	unit: TextMotionUnit;
	defaults: TextMotionEffectBase;
	channels: (progress: number, context: TextMotionChannelContext) => Partial<GlyphMotionState>;
}
