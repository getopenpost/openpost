import type { KeyframeProperty, KeyframeTrack, TimelineItem } from '../project/types';
import { applyEasing, applyEasingConfig } from './easing';
import { activePositionKeyframes, interpolatePosition } from './vector-keyframes';

/** Evaluate one property at an item-relative frame without touching editor state. */
export function interpolateAt(
	item: TimelineItem,
	property: KeyframeProperty,
	frame: number
): number | null {
	if (property === 'x' || property === 'y') {
		const position = activePositionKeyframes(item);
		if (position) return interpolatePosition(position, frame)?.[property] ?? null;
	}
	const track: KeyframeTrack | undefined = item.keyframes?.[property];
	if (!track || track.frames.length === 0) return null;
	const { frames, values } = track;
	if (track.frames.length === 1) return values[0];
	if (frame <= frames[0]) return values[0];
	const last = frames.length - 1;
	if (frame >= frames[last]) return values[last];
	for (let index = 1; index <= last; index++) {
		if (frame > frames[index]) continue;
		const progress = (frame - frames[index - 1]) / (frames[index] - frames[index - 1]);
		const easingConfig = track.easingConfigs?.[index - 1] ?? undefined;
		const easedProgress = easingConfig
			? applyEasingConfig(progress, easingConfig)
			: applyEasing(progress, track.easings?.[index - 1] ?? 'linear');
		return values[index - 1] + easedProgress * (values[index] - values[index - 1]);
	}
	return values[last];
}

/** Evaluate one property at an absolute timeline frame. */
export function activeValueAt(
	item: TimelineItem,
	property: KeyframeProperty,
	absoluteFrame: number
): number | null {
	return interpolateAt(item, property, absoluteFrame - item.from);
}
