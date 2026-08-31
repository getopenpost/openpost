import type { EditorKeyframe } from './keyframe-editor';

export type KeyframeEditorMode = 'graph' | 'dopesheet' | 'split';

export function adjacentKeyframe(
	keyframes: readonly EditorKeyframe[],
	currentFrame: number,
	direction: 'previous' | 'next'
): EditorKeyframe | undefined {
	const ordered = [...keyframes].toSorted((left, right) => left.frame - right.frame);
	return direction === 'previous'
		? ordered.findLast((keyframe) => keyframe.frame < currentFrame)
		: ordered.find((keyframe) => keyframe.frame > currentFrame);
}

export function keyframeShortcutScopeActive(
	target: EventTarget | null,
	pointerInside: boolean
): boolean {
	return (
		pointerInside ||
		(target instanceof HTMLElement && target.closest('[data-keyframe-shortcuts]') !== null)
	);
}
