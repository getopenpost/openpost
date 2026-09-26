import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import {
	AUDIO_VOLUME_DB_MAX,
	AUDIO_VOLUME_DB_MIN,
	audioVolumeDbFromDrag,
	clampAudioVolumeDb
} from '$lib/video-editor/timeline/audio-volume-line';
import { dbToLinearGain, linearGainToDb } from '$lib/video-editor/media/clip-fades';
import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';
import { shuttleScrubResume } from '$lib/video-editor/preview/shuttle-scrub-resume.svelte';
import {
	captureSnapshot,
	restoreSnapshot
} from '$lib/video-editor/timeline/commands/snapshot.svelte';
import { snapshotsEqual } from '$lib/video-editor/timeline/commands/snapshot.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';

export interface TimelineAudioVolumeInput {
	isEditToolActive: () => boolean;
	onedit: () => void;
}

/** Large keyboard step for the clip volume slider, matching the mixer fader convention. */
export const CLIP_VOLUME_KEYBOARD_LARGE_STEP_DB = 6;

/**
 * Pure key mapping for the timeline clip volume slider. Arrows step half a
 * decibel (three with shift), PageUp/PageDown jump six decibels, and
 * Home/End jump to the volume bounds. Returns null for unhandled keys so the
 * caller can skip side effects.
 */
export function nextClipVolumeKeyboardDb(
	currentDb: number,
	key: string,
	shiftKey: boolean
): number | null {
	if (key === 'ArrowUp') return currentDb + (shiftKey ? 3 : 0.5);
	if (key === 'ArrowDown') return currentDb - (shiftKey ? 3 : 0.5);
	if (key === 'PageUp') return currentDb + CLIP_VOLUME_KEYBOARD_LARGE_STEP_DB;
	if (key === 'PageDown') return currentDb - CLIP_VOLUME_KEYBOARD_LARGE_STEP_DB;
	if (key === 'Home') return AUDIO_VOLUME_DB_MIN;
	if (key === 'End') return AUDIO_VOLUME_DB_MAX;
	return null;
}

type AudioVolumeDrag = {
	pointerId: number;
	itemId: string;
	startClientY: number;
	latestClientY: number;
	startDb: number;
	rowHeight: number;
	beforeSnapshot: TimelineSnapshot;
	target: HTMLButtonElement;
	animationFrame: number | null;
	activated: boolean;
};

/**
 * Clip audio-volume gesture for the timeline: drag, keyboard and reset
 * actions. Owns the drag state machine; the panel forwards template events.
 */
export class TimelineAudioVolume {
	audioVolumeDrag = $state.raw<AudioVolumeDrag | null>(null);
	constructor(private readonly input: TimelineAudioVolumeInput) {}
	audioVolumeDb(item: TimelineItem): number {
		return linearGainToDb(item.volume ?? 1);
	}
	private applyAudioVolumeFrame(clientY: number): void {
		if (!this.audioVolumeDrag) return;
		const pointerDeltaY = clientY - this.audioVolumeDrag.startClientY;
		if (!this.audioVolumeDrag.activated && Math.abs(pointerDeltaY) < 4) return;
		this.audioVolumeDrag.activated = true;
		const nextDb = audioVolumeDbFromDrag({
			startDb: this.audioVolumeDrag.startDb,
			pointerDeltaY,
			height: this.audioVolumeDrag.rowHeight
		});
		timelineStore._updateItems([
			{ id: this.audioVolumeDrag.itemId, patch: { volume: dbToLinearGain(nextDb) } }
		]);
	}
	private removeAudioVolumeListeners(completed: AudioVolumeDrag): void {
		window.removeEventListener('pointermove', this.onAudioVolumePointerMove);
		window.removeEventListener('pointerup', this.onAudioVolumePointerUp);
		window.removeEventListener('pointercancel', this.onAudioVolumePointerCancel);
		window.removeEventListener('keydown', this.onAudioVolumeKeydown);
		completed.target.removeEventListener(
			'lostpointercapture',
			this.onAudioVolumeLostPointerCapture
		);
	}
	finishAudioVolumeDrag(cancelled: boolean): void {
		if (!this.audioVolumeDrag) return;
		const completed = this.audioVolumeDrag;
		if (completed.animationFrame !== null) cancelAnimationFrame(completed.animationFrame);
		if (!cancelled) this.applyAudioVolumeFrame(completed.latestClientY);
		this.audioVolumeDrag = null;
		this.removeAudioVolumeListeners(completed);
		if (completed.target.hasPointerCapture(completed.pointerId)) {
			completed.target.releasePointerCapture(completed.pointerId);
		}
		if (cancelled) {
			restoreSnapshot(completed.beforeSnapshot);
			return;
		}
		if (!snapshotsEqual(completed.beforeSnapshot, captureSnapshot())) {
			commandHistory.addUndoEntry({ type: 'ADJUST_CLIP_VOLUME' }, completed.beforeSnapshot);
			this.input.onedit();
		}
	}
	private onAudioVolumePointerMove = (event: PointerEvent): void => {
		if (!this.audioVolumeDrag || event.pointerId !== this.audioVolumeDrag.pointerId) return;
		this.audioVolumeDrag.latestClientY = event.clientY;
		if (this.audioVolumeDrag.animationFrame !== null) return;
		this.audioVolumeDrag.animationFrame = requestAnimationFrame(() => {
			if (!this.audioVolumeDrag) return;
			this.audioVolumeDrag.animationFrame = null;
			this.applyAudioVolumeFrame(this.audioVolumeDrag.latestClientY);
		});
	};
	private onAudioVolumePointerUp = (event: PointerEvent): void => {
		if (!this.audioVolumeDrag || event.pointerId !== this.audioVolumeDrag.pointerId) return;
		this.audioVolumeDrag.latestClientY = event.clientY;
		this.finishAudioVolumeDrag(false);
	};
	private onAudioVolumePointerCancel = (event: PointerEvent): void => {
		if (this.audioVolumeDrag?.pointerId === event.pointerId) this.finishAudioVolumeDrag(true);
	};
	private onAudioVolumeLostPointerCapture = (event: PointerEvent): void => {
		if (this.audioVolumeDrag?.pointerId === event.pointerId) this.finishAudioVolumeDrag(true);
	};
	private onAudioVolumeKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || !this.audioVolumeDrag) return;
		event.preventDefault();
		this.finishAudioVolumeDrag(true);
	};
	startAudioVolumeDrag(
		event: PointerEvent & { currentTarget: HTMLButtonElement },
		item: TimelineItem
	): void {
		if (
			event.button !== 0 ||
			item.type !== 'audio' ||
			this.input.isEditToolActive() ||
			isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		shuttleScrubResume.cancel();
		const target = event.currentTarget;
		const rowHeight = target.parentElement?.getBoundingClientRect().height ?? 56;
		this.audioVolumeDrag = {
			pointerId: event.pointerId,
			itemId: item.id,
			startClientY: event.clientY,
			latestClientY: event.clientY,
			startDb: this.audioVolumeDb(item),
			rowHeight,
			beforeSnapshot: captureSnapshot(),
			target,
			animationFrame: null,
			activated: false
		};
		try {
			target.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events and older browsers may not own an active capture.
			// Window listeners still preserve the complete gesture lifecycle.
		}
		target.addEventListener('lostpointercapture', this.onAudioVolumeLostPointerCapture);
		window.addEventListener('pointermove', this.onAudioVolumePointerMove);
		window.addEventListener('pointerup', this.onAudioVolumePointerUp);
		window.addEventListener('pointercancel', this.onAudioVolumePointerCancel);
		window.addEventListener('keydown', this.onAudioVolumeKeydown);
	}
	setAudioVolumeFromTimeline(item: TimelineItem, nextDb: number): void {
		const before = captureSnapshot();
		const nextGain = dbToLinearGain(clampAudioVolumeDb(nextDb));
		timelineStore._updateItems([{ id: item.id, patch: { volume: nextGain } }]);
		if (!snapshotsEqual(before, captureSnapshot())) {
			commandHistory.addUndoEntry({ type: 'ADJUST_CLIP_VOLUME' }, before);
			this.input.onedit();
		}
	}
	adjustAudioVolumeWithKeyboard(event: KeyboardEvent, item: TimelineItem): void {
		const current = timelineStore.itemById.get(item.id);
		if (!current || current.type !== 'audio') return;
		const next = nextClipVolumeKeyboardDb(this.audioVolumeDb(current), event.key, event.shiftKey);
		if (next === null) return;
		event.preventDefault();
		this.setAudioVolumeFromTimeline(current, next);
	}
}
