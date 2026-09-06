/** Volatile hover-preview state. It never changes the committed playhead. */

import { writable } from 'svelte/store';

export interface TimelinePreviewScrubState {
	frame: number | null;
}

let currentFrame: number | null = null;
const state = writable<TimelinePreviewScrubState>({ frame: currentFrame });

export const timelinePreviewScrub = {
	subscribe: state.subscribe,
	setFrame(nextFrame: number): void {
		if (!Number.isFinite(nextFrame)) return;
		const frame = Math.max(0, Math.round(nextFrame));
		if (frame === currentFrame) return;
		currentFrame = frame;
		state.set({ frame });
	},
	clear(): void {
		if (currentFrame === null) return;
		currentFrame = null;
		state.set({ frame: null });
	},
	__resetForTesting(): void {
		currentFrame = null;
		state.set({ frame: null });
	}
};

export function resolveTimelinePreviewFrame(
	preview: TimelinePreviewScrubState,
	committedFrame: number
): number {
	return preview.frame ?? committedFrame;
}

export function formatTimelinePreviewTimecode(frame: number, fps: number): string {
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	const nominalFps = Math.max(1, Math.round(safeFps));
	const safeFrame = Math.max(0, Math.round(frame));
	const totalSeconds = Math.floor(safeFrame / nominalFps);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const frames = safeFrame % nominalFps;
	return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':');
}
