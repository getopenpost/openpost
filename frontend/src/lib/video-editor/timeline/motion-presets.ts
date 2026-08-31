import type { EasingConfig, EasingType } from '$lib/video-editor/project/types';
import {
	animationWindowFrames as windowFrames,
	clamp,
	EASE_IN_SOFT,
	EASE_OUT_SOFT,
	SPRING_SETTLE
} from './animation-easing';

export type MotionPresetCategory = 'entrance' | 'exit' | 'emphasis';
export type MotionPresetProperty = 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity';

export type MotionPresetId =
	| 'fade-in'
	| 'slide-in-left'
	| 'slide-in-right'
	| 'slide-in-up'
	| 'slide-in-down'
	| 'pop-in'
	| 'zoom-in'
	| 'spin-in'
	| 'bounce-in'
	| 'fade-out'
	| 'slide-out-left'
	| 'slide-out-right'
	| 'slide-out-up'
	| 'slide-out-down'
	| 'pop-out'
	| 'zoom-out'
	| 'pulse'
	| 'shake'
	| 'wobble'
	| 'flash';

export interface ResolvedMotionTransform {
	x: number;
	y: number;
	width: number;
	height: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	opacity: number;
}

export interface MotionThumbnail {
	kind:
		| 'fade'
		| 'slide'
		| 'scale'
		| 'spin'
		| 'bounce'
		| 'pulse'
		| 'shake'
		| 'wobble'
		| 'drift'
		| 'micro-shake';
	angle?: number;
	direction?: 1 | -1;
}

export interface MotionPresetKeyframePayload {
	property: MotionPresetProperty;
	frame: number;
	value: number;
	easing: EasingType;
	easingConfig?: EasingConfig;
}

export interface MotionPresetBuildContext {
	anchor: ResolvedMotionTransform;
	durationInFrames: number;
	fps: number;
	frameWidth: number;
	frameHeight: number;
}

export interface MotionPreset {
	id: MotionPresetId;
	category: MotionPresetCategory;
	labelKey: string;
	thumbnail: MotionThumbnail;
	properties: MotionPresetProperty[];
	build: (context: MotionPresetBuildContext) => MotionPresetKeyframePayload[];
}

const OVERSHOOT: EasingConfig = {
	type: 'cubic-bezier',
	bezier: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 }
};
const BOUNCE: EasingConfig = {
	type: 'cubic-bezier',
	bezier: { x1: 0.2, y1: 1.5, x2: 0.4, y2: 1 }
};
const ENTRANCE_SECONDS = 0.5;
const EMPHASIS_SECONDS = 0.6;

export function getMotionPresetAnchorFrame(
	category: MotionPresetCategory,
	durationInFrames: number,
	fps: number
): number {
	const maxFrame = Math.max(0, durationInFrames - 1);
	switch (category) {
		case 'entrance':
			return Math.min(maxFrame, windowFrames(ENTRANCE_SECONDS, durationInFrames, fps));
		case 'exit':
			return Math.max(0, maxFrame - windowFrames(ENTRANCE_SECONDS, durationInFrames, fps));
		case 'emphasis':
			return 0;
	}
}

function keyframe(
	property: MotionPresetProperty,
	frame: number,
	value: number,
	easing: EasingType,
	easingConfig?: EasingConfig
): MotionPresetKeyframePayload {
	return { property, frame, value, easing, easingConfig };
}

function entrancePair(
	property: MotionPresetProperty,
	startFrame: number,
	endFrame: number,
	offset: number,
	rest: number,
	config: EasingConfig
): MotionPresetKeyframePayload[] {
	return [
		keyframe(property, startFrame, offset, 'cubic-bezier', config),
		keyframe(property, endFrame, rest, 'linear')
	];
}

function exitPair(
	property: MotionPresetProperty,
	startFrame: number,
	endFrame: number,
	rest: number,
	offset: number
): MotionPresetKeyframePayload[] {
	return [
		keyframe(property, startFrame, rest, 'cubic-bezier', EASE_IN_SOFT),
		keyframe(property, endFrame, offset, 'linear')
	];
}

function slideTravel(frameSize: number): number {
	return clamp(frameSize * 0.25, 80, 600);
}

function buildEntrance(
	context: MotionPresetBuildContext,
	build: (start: number, end: number) => MotionPresetKeyframePayload[]
): MotionPresetKeyframePayload[] {
	const end = windowFrames(ENTRANCE_SECONDS, context.durationInFrames, context.fps);
	return end <= 0 ? [] : build(0, end);
}

function buildExit(
	context: MotionPresetBuildContext,
	build: (start: number, end: number) => MotionPresetKeyframePayload[]
): MotionPresetKeyframePayload[] {
	const length = windowFrames(ENTRANCE_SECONDS, context.durationInFrames, context.fps);
	if (length <= 0) return [];
	const last = context.durationInFrames - 1;
	return build(last - length, last);
}

function buildEmphasis(
	context: MotionPresetBuildContext,
	build: (start: number, middle: number, end: number) => MotionPresetKeyframePayload[]
): MotionPresetKeyframePayload[] {
	const length = windowFrames(EMPHASIS_SECONDS, context.durationInFrames, context.fps);
	if (length <= 0) return [];
	return build(0, Math.max(1, Math.round(length / 2)), length);
}

export const MOTION_PRESETS: MotionPreset[] = [
	{
		id: 'fade-in',
		category: 'entrance',
		labelKey: 'fadeIn',
		thumbnail: { kind: 'fade' },
		properties: ['opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) =>
				entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			)
	},
	{
		id: 'slide-in-left',
		category: 'entrance',
		labelKey: 'slideInLeft',
		thumbnail: { kind: 'slide', angle: 0 },
		properties: ['x', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'x',
					start,
					end,
					context.anchor.x - slideTravel(context.frameWidth),
					context.anchor.x,
					SPRING_SETTLE
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'slide-in-right',
		category: 'entrance',
		labelKey: 'slideInRight',
		thumbnail: { kind: 'slide', angle: 180 },
		properties: ['x', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'x',
					start,
					end,
					context.anchor.x + slideTravel(context.frameWidth),
					context.anchor.x,
					SPRING_SETTLE
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'slide-in-up',
		category: 'entrance',
		labelKey: 'slideInUp',
		thumbnail: { kind: 'slide', angle: 270 },
		properties: ['y', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'y',
					start,
					end,
					context.anchor.y + slideTravel(context.frameHeight),
					context.anchor.y,
					SPRING_SETTLE
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'slide-in-down',
		category: 'entrance',
		labelKey: 'slideInDown',
		thumbnail: { kind: 'slide', angle: 90 },
		properties: ['y', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'y',
					start,
					end,
					context.anchor.y - slideTravel(context.frameHeight),
					context.anchor.y,
					SPRING_SETTLE
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'pop-in',
		category: 'entrance',
		labelKey: 'popIn',
		thumbnail: { kind: 'scale', direction: 1 },
		properties: ['scaleX', 'scaleY', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'scaleX',
					start,
					end,
					context.anchor.scaleX * 0.6,
					context.anchor.scaleX,
					OVERSHOOT
				),
				...entrancePair(
					'scaleY',
					start,
					end,
					context.anchor.scaleY * 0.6,
					context.anchor.scaleY,
					OVERSHOOT
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'zoom-in',
		category: 'entrance',
		labelKey: 'zoomIn',
		thumbnail: { kind: 'scale', direction: -1 },
		properties: ['scaleX', 'scaleY', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'scaleX',
					start,
					end,
					context.anchor.scaleX * 1.4,
					context.anchor.scaleX,
					EASE_OUT_SOFT
				),
				...entrancePair(
					'scaleY',
					start,
					end,
					context.anchor.scaleY * 1.4,
					context.anchor.scaleY,
					EASE_OUT_SOFT
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'spin-in',
		category: 'entrance',
		labelKey: 'spinIn',
		thumbnail: { kind: 'spin' },
		properties: ['rotation', 'scaleX', 'scaleY', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'rotation',
					start,
					end,
					context.anchor.rotation - 180,
					context.anchor.rotation,
					SPRING_SETTLE
				),
				...entrancePair(
					'scaleX',
					start,
					end,
					context.anchor.scaleX * 0.8,
					context.anchor.scaleX,
					SPRING_SETTLE
				),
				...entrancePair(
					'scaleY',
					start,
					end,
					context.anchor.scaleY * 0.8,
					context.anchor.scaleY,
					SPRING_SETTLE
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'bounce-in',
		category: 'entrance',
		labelKey: 'bounceIn',
		thumbnail: { kind: 'bounce' },
		properties: ['y', 'opacity'],
		build: (context) =>
			buildEntrance(context, (start, end) => [
				...entrancePair(
					'y',
					start,
					end,
					context.anchor.y - slideTravel(context.frameHeight) * 0.6,
					context.anchor.y,
					BOUNCE
				),
				...entrancePair('opacity', start, end, 0, context.anchor.opacity, EASE_OUT_SOFT)
			])
	},
	{
		id: 'fade-out',
		category: 'exit',
		labelKey: 'fadeOut',
		thumbnail: { kind: 'fade' },
		properties: ['opacity'],
		build: (context) =>
			buildExit(context, (start, end) => exitPair('opacity', start, end, context.anchor.opacity, 0))
	},
	{
		id: 'slide-out-left',
		category: 'exit',
		labelKey: 'slideOutLeft',
		thumbnail: { kind: 'slide', angle: 180 },
		properties: ['x', 'opacity'],
		build: (context) =>
			buildExit(context, (start, end) => [
				...exitPair(
					'x',
					start,
					end,
					context.anchor.x,
					context.anchor.x - slideTravel(context.frameWidth)
				),
				...exitPair('opacity', start, end, context.anchor.opacity, 0)
			])
	},
	{
		id: 'slide-out-right',
		category: 'exit',
		labelKey: 'slideOutRight',
		thumbnail: { kind: 'slide', angle: 0 },
		properties: ['x', 'opacity'],
		build: (context) =>
			buildExit(context, (start, end) => [
				...exitPair(
					'x',
					start,
					end,
					context.anchor.x,
					context.anchor.x + slideTravel(context.frameWidth)
				),
				...exitPair('opacity', start, end, context.anchor.opacity, 0)
			])
	},
	{
		id: 'slide-out-up',
		category: 'exit',
		labelKey: 'slideOutUp',
		thumbnail: { kind: 'slide', angle: 270 },
		properties: ['y', 'opacity'],
		build: (context) =>
			buildExit(context, (start, end) => [
				...exitPair(
					'y',
					start,
					end,
					context.anchor.y,
					context.anchor.y - slideTravel(context.frameHeight)
				),
				...exitPair('opacity', start, end, context.anchor.opacity, 0)
			])
	},
	{
		id: 'slide-out-down',
		category: 'exit',
		labelKey: 'slideOutDown',
		thumbnail: { kind: 'slide', angle: 90 },
		properties: ['y', 'opacity'],
		build: (context) =>
			buildExit(context, (start, end) => [
				...exitPair(
					'y',
					start,
					end,
					context.anchor.y,
					context.anchor.y + slideTravel(context.frameHeight)
				),
				...exitPair('opacity', start, end, context.anchor.opacity, 0)
			])
	},
	{
		id: 'pop-out',
		category: 'exit',
		labelKey: 'popOut',
		thumbnail: { kind: 'scale', direction: -1 },
		properties: ['scaleX', 'scaleY', 'opacity'],
		build: (context) =>
			buildExit(context, (start, end) => [
				...exitPair('scaleX', start, end, context.anchor.scaleX, context.anchor.scaleX * 0.6),
				...exitPair('scaleY', start, end, context.anchor.scaleY, context.anchor.scaleY * 0.6),
				...exitPair('opacity', start, end, context.anchor.opacity, 0)
			])
	},
	{
		id: 'zoom-out',
		category: 'exit',
		labelKey: 'zoomOut',
		thumbnail: { kind: 'scale', direction: 1 },
		properties: ['scaleX', 'scaleY', 'opacity'],
		build: (context) =>
			buildExit(context, (start, end) => [
				...exitPair('scaleX', start, end, context.anchor.scaleX, context.anchor.scaleX * 1.4),
				...exitPair('scaleY', start, end, context.anchor.scaleY, context.anchor.scaleY * 1.4),
				...exitPair('opacity', start, end, context.anchor.opacity, 0)
			])
	},
	{
		id: 'pulse',
		category: 'emphasis',
		labelKey: 'pulse',
		thumbnail: { kind: 'pulse' },
		properties: ['scaleX', 'scaleY'],
		build: (context) =>
			buildEmphasis(context, (start, middle, end) => [
				keyframe('scaleX', start, context.anchor.scaleX, 'ease-out'),
				keyframe('scaleX', middle, context.anchor.scaleX * 1.15, 'ease-in-out'),
				keyframe('scaleX', end, context.anchor.scaleX, 'ease-in'),
				keyframe('scaleY', start, context.anchor.scaleY, 'ease-out'),
				keyframe('scaleY', middle, context.anchor.scaleY * 1.15, 'ease-in-out'),
				keyframe('scaleY', end, context.anchor.scaleY, 'ease-in')
			])
	},
	{
		id: 'shake',
		category: 'emphasis',
		labelKey: 'shake',
		thumbnail: { kind: 'shake' },
		properties: ['x'],
		build: (context) => {
			const length = windowFrames(EMPHASIS_SECONDS, context.durationInFrames, context.fps);
			if (length <= 0) return [];
			const amplitude = clamp(context.frameWidth * 0.02, 6, 40);
			const payloads: MotionPresetKeyframePayload[] = [];
			for (let index = 0; index <= 6; index += 1) {
				const frame = Math.round((index / 6) * length);
				const decay = 1 - index / 6;
				const value =
					context.anchor.x + (index % 2 === 0 ? 0 : amplitude) * decay * (index % 4 < 2 ? 1 : -1);
				payloads.push(keyframe('x', frame, value, 'ease-in-out'));
			}
			payloads.push(keyframe('x', length, context.anchor.x, 'linear'));
			return payloads;
		}
	},
	{
		id: 'wobble',
		category: 'emphasis',
		labelKey: 'wobble',
		thumbnail: { kind: 'wobble' },
		properties: ['rotation'],
		build: (context) =>
			buildEmphasis(context, (start, middle, end) => [
				keyframe('rotation', start, context.anchor.rotation, 'ease-out'),
				keyframe('rotation', Math.round(middle / 2), context.anchor.rotation + 8, 'ease-in-out'),
				keyframe('rotation', middle, context.anchor.rotation - 8, 'ease-in-out'),
				keyframe(
					'rotation',
					Math.round((middle + end) / 2),
					context.anchor.rotation + 4,
					'ease-in-out'
				),
				keyframe('rotation', end, context.anchor.rotation, 'ease-in')
			])
	},
	{
		id: 'flash',
		category: 'emphasis',
		labelKey: 'flash',
		thumbnail: { kind: 'fade' },
		properties: ['opacity'],
		build: (context) =>
			buildEmphasis(context, (start, middle, end) => [
				keyframe('opacity', start, context.anchor.opacity, 'ease-out'),
				keyframe('opacity', middle, context.anchor.opacity * 0.15, 'ease-in-out'),
				keyframe('opacity', end, context.anchor.opacity, 'ease-in')
			])
	}
];

export const MOTION_PRESETS_BY_ID = new Map(
	MOTION_PRESETS.map((preset) => [preset.id, preset] as const)
);

export function motionPresetById(id: MotionPresetId): MotionPreset {
	const preset = MOTION_PRESETS_BY_ID.get(id);
	if (!preset) throw new Error(`Unknown motion preset: ${id}`);
	return preset;
}

export const MOTION_PRESET_CATEGORIES: MotionPresetCategory[] = ['entrance', 'exit', 'emphasis'];
