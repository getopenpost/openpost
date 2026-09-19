import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { m } from '$lib/paraglide/messages';
import {
	addMarker,
	removeMarker,
	selectMarker as selectMarkerAction,
	updateMarker
} from '$lib/video-editor/timeline/actions/items';
import { markerDisplayName } from '$lib/video-editor/timeline/markers';
import {
	captureSnapshot,
	restoreSnapshot
} from '$lib/video-editor/timeline/commands/snapshot.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { shuttleScrubResume } from '$lib/video-editor/preview/shuttle-scrub-resume.svelte';
import type { TimelineMarker } from '$lib/video-editor/project/types';
import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';

export interface TimelineMarkerControlsInput {
	onClearSelection: () => void;
	setCurrentFrame: (frame: number) => void;
	frameFromClientX: (clientX: number) => number | undefined;
	clearHoverPreview: () => void;
	onedit: () => void;
}

/**
 * Marker feature for the timeline: CRUD, label editing, drag gesture and
 * selection sync. State moves with its logic; the panel keeps selection
 * ownership and passes callbacks in.
 */
export class TimelineMarkerControls {
	markerDrag: {
		pointerId: number;
		markerId: string;
		beforeSnapshot: TimelineSnapshot;
		changed: boolean;
		bodyCursor: string;
		bodyUserSelect: string;
	} | null = null;
	markerLabelDraft = $state('');
	markerLabelDraftId = '';
	selectedMarker = $derived(
		timelineStore.markers.find((marker) => marker.id === timelineStore.selectedMarkerId) ?? null
	);

	syncDraft(): void {
		const marker = this.selectedMarker;
		if (!marker) {
			this.markerLabelDraftId = '';
			this.markerLabelDraft = '';
			return;
		}
		if (marker.id === this.markerLabelDraftId) return;
		this.markerLabelDraftId = marker.id;
		this.markerLabelDraft = marker.label ?? '';
	}
	markerName(marker: TimelineMarker): string {
		const ordered = [...timelineStore.markers].sort(
			(left, right) => left.frame - right.frame || left.id.localeCompare(right.id)
		);
		const index = Math.max(
			0,
			ordered.findIndex((candidate) => candidate.id === marker.id)
		);
		return markerDisplayName(marker, index, (number) => m.video_editor_marker_number({ number }));
	}
	markerColorForInput(color: string): string {
		return /^#[0-9a-f]{6}$/i.test(color) ? color : '#d97746';
	}
	selectMarker(marker: TimelineMarker): void {
		if (!selectMarkerAction(marker.id)) return;
		this.input.onClearSelection();
	}
	addMarkerAtPlayhead(): void {
		const id = addMarker(timelineStore.currentFrame);
		timelineStore._setSelectedMarkerId(id);
		this.input.onClearSelection();
		this.input.onedit();
	}
	deleteTimelineMarker(markerId: string): void {
		if (!timelineStore.markers.some((marker) => marker.id === markerId)) return;
		removeMarker(markerId);
		this.input.onedit();
	}
	commitMarkerPatch(
		marker: TimelineMarker,
		patch: Partial<{ frame: number; label: string; color: string }>
	): void {
		const changed =
			(patch.frame !== undefined && patch.frame !== marker.frame) ||
			(patch.label !== undefined && patch.label !== (marker.label ?? '')) ||
			(patch.color !== undefined && patch.color !== marker.color);
		if (!changed) return;
		if (patch.frame !== undefined) this.input.setCurrentFrame(patch.frame);
		if (updateMarker(marker.id, patch)) this.input.onedit();
	}
	private applyMarkerDrag(clientX: number): void {
		if (!this.markerDrag) return;
		const frame = this.input.frameFromClientX(clientX);
		if (frame === undefined) return;
		const marker = timelineStore.markers.find(
			(candidate) => candidate.id === this.markerDrag?.markerId
		);
		if (!marker || marker.frame === frame) return;
		timelineStore.setAll({
			markers: timelineStore.markers.map((candidate) =>
				candidate.id === marker.id ? { ...candidate, frame } : candidate
			)
		});
		this.input.setCurrentFrame(frame);
		this.markerDrag.changed = true;
	}
	private moveMarkerDrag = (event: PointerEvent): void => {
		if (!this.markerDrag || event.pointerId !== this.markerDrag.pointerId) return;
		event.preventDefault();
		this.applyMarkerDrag(event.clientX);
	};
	private cleanupMarkerDrag(): void {
		if (!this.markerDrag) return;
		document.body.style.cursor = this.markerDrag.bodyCursor;
		document.body.style.userSelect = this.markerDrag.bodyUserSelect;
		window.removeEventListener('pointermove', this.moveMarkerDrag);
		window.removeEventListener('pointerup', this.finishMarkerDrag);
		window.removeEventListener('pointercancel', this.cancelMarkerDrag);
		window.removeEventListener('keydown', this.onMarkerDragKeydown);
		this.markerDrag = null;
	}
	completeMarkerDrag(cancelled: boolean): void {
		if (!this.markerDrag) return;
		const beforeSnapshot = this.markerDrag.beforeSnapshot;
		const changed = this.markerDrag.changed;
		if (cancelled && changed) restoreSnapshot(beforeSnapshot);
		if (!cancelled && changed) timelineStore._setMarkers([...timelineStore.markers]);
		this.cleanupMarkerDrag();
		if (!cancelled && changed) {
			commandHistory.addUndoEntry({ type: 'MOVE_MARKER' }, beforeSnapshot);
			this.input.onedit();
		}
	}
	private finishMarkerDrag = (event: PointerEvent): void => {
		if (!this.markerDrag || event.pointerId !== this.markerDrag.pointerId) return;
		event.preventDefault();
		this.completeMarkerDrag(false);
	};
	private cancelMarkerDrag = (event?: PointerEvent): void => {
		if (event && this.markerDrag && event.pointerId !== this.markerDrag.pointerId) return;
		this.completeMarkerDrag(true);
	};
	private onMarkerDragKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		this.completeMarkerDrag(true);
	};
	startMarkerDrag(event: PointerEvent, marker: TimelineMarker): void {
		shuttleScrubResume.cancel();
		if (event.button !== 0 || this.markerDrag) return;
		this.input.clearHoverPreview();
		event.preventDefault();
		event.stopPropagation();
		editorSession.pausePlayback();
		this.selectMarker(marker);
		this.markerDrag = {
			pointerId: event.pointerId,
			markerId: marker.id,
			beforeSnapshot: captureSnapshot(),
			changed: false,
			bodyCursor: document.body.style.cursor,
			bodyUserSelect: document.body.style.userSelect
		};
		document.body.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', this.moveMarkerDrag);
		window.addEventListener('pointerup', this.finishMarkerDrag);
		window.addEventListener('pointercancel', this.cancelMarkerDrag);
		window.addEventListener('keydown', this.onMarkerDragKeydown);
	}
	onMarkerKeydown(event: KeyboardEvent, marker: TimelineMarker): void {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			this.deleteTimelineMarker(marker.id);
			return;
		}
		let frame: number | null = null;
		if (event.key === 'ArrowLeft') frame = marker.frame - (event.shiftKey ? 10 : 1);
		else if (event.key === 'ArrowRight') frame = marker.frame + (event.shiftKey ? 10 : 1);
		else if (event.key === 'Home') frame = 0;
		else if (event.key === 'End') frame = timelineStore.maxItemEndFrame;
		else return;
		event.preventDefault();
		event.stopPropagation();
		this.commitMarkerPatch(marker, { frame: Math.max(0, frame) });
	}
	constructor(private readonly input: TimelineMarkerControlsInput) {}
}
