/** Shared drag payload for inserting exact scene ranges on the timeline. */

import type { MediaScene } from './types';

export interface SceneDragData {
	type: 'timeline-scene';
	scene: MediaScene;
}

let activeSceneDrag: SceneDragData | null = null;

export function setSceneDragData(payload: SceneDragData): void {
	activeSceneDrag = payload;
}

export function clearSceneDragData(): void {
	activeSceneDrag = null;
}

export function getSceneDragData(dataTransfer?: DataTransfer | null): SceneDragData | null {
	if (activeSceneDrag) return activeSceneDrag;
	const raw = dataTransfer?.getData('application/json');
	if (!raw) return null;
	try {
		// SAFETY: JSON.parse returns JSON primitives; guarded below by `type` and `scene.id` checks before use.
		const parsed = JSON.parse(raw) as Partial<SceneDragData>;
		// SAFETY: branch verifies `parsed.type === 'timeline-scene'` and `parsed.scene?.id` exists, so the narrowed payload matches `SceneDragData`.
		return parsed.type === 'timeline-scene' && parsed.scene?.id ? (parsed as SceneDragData) : null;
	} catch {
		return null;
	}
}
