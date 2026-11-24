import type {
	DirectLinkableProperty,
	EasingType,
	KeyframeProperty,
	TextMotionPresetId
} from '$lib/video-editor/project/types';
import {
	TEXT_MOTION_IN_PRESET_IDS,
	TEXT_MOTION_LOOP_PRESET_IDS,
	TEXT_MOTION_OUT_PRESET_IDS
} from '$lib/video-editor/project/types';
import { ALL_BLEND_MODES, type BlendMode } from '$lib/video-editor/effects/gpu/blend-modes';
import type {
	MotionTimelineLayerRow,
	MotionTimelineRow
} from '$lib/video-editor/timeline/motion-timeline-rows';

/*
 * Pure row keys and value guards for the composition timeline. Select and
 * input controls report strings; these narrow them to the editor's typed
 * properties before any timeline action runs.
 */

export function isLayerRow(row: MotionTimelineRow): row is MotionTimelineLayerRow {
	return row.kind === 'layer';
}

export function motionRowKey(row: MotionTimelineRow): string {
	return row.kind === 'group' ? `group:${row.track.id}` : `layer:${row.item.id}`;
}

export function isBlendMode(value: string): value is BlendMode {
	return ALL_BLEND_MODES.some((mode) => mode === value);
}

function isKeyframeProperty(value: string): value is KeyframeProperty {
	return (
		value === 'x' ||
		value === 'y' ||
		value === 'width' ||
		value === 'height' ||
		value === 'anchorX' ||
		value === 'anchorY' ||
		value === 'rotation' ||
		value === 'opacity' ||
		value === 'scaleX' ||
		value === 'scaleY'
	);
}
export function isEasingType(value: string): value is EasingType {
	return (
		value === 'linear' || value === 'ease-in' || value === 'ease-out' || value === 'ease-in-out'
	);
}

export function isDirectLinkableProperty(value: string): value is DirectLinkableProperty {
	return (
		isKeyframeProperty(value) ||
		value === 'cornerRadius' ||
		value === 'position' ||
		value === 'scale' ||
		value === 'anchor'
	);
}

const TEXT_PRESET_SET = new Set<string>([
	...TEXT_MOTION_IN_PRESET_IDS,
	...TEXT_MOTION_OUT_PRESET_IDS,
	...TEXT_MOTION_LOOP_PRESET_IDS
]);

export function isTextMotionPresetId(value: string): value is TextMotionPresetId {
	return TEXT_PRESET_SET.has(value);
}
