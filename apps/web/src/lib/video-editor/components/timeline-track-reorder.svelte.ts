import { onDestroy } from 'svelte';
import type { TimelineTrack } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { reorderTrackList } from '../timeline/track-reorder';
import { moveTrackTo } from '../timeline/actions/tracks';

const DRAG_THRESHOLD = 6;
const SCROLL_EDGE = 40;
const SCROLL_SPEED = 10;

export function createTrackReorder(container: () => HTMLElement | null, onedit: () => void) {
	let draft = $state.raw<TimelineTrack[] | null>(null);
	let gesture: {
		id: string;
		pointerId: number;
		startY: number;
		y: number;
		source: TimelineTrack[];
		rows: { id: string; top: number; bottom: number }[];
	} | null = null;
	let scrollFrame = 0;
	function cancel() {
		gesture = null;
		draft = null;
		cancelAnimationFrame(scrollFrame);
		window.removeEventListener('pointermove', move);
		window.removeEventListener('pointerup', drop);
		window.removeEventListener('pointercancel', cancel);
		window.removeEventListener('keydown', keydown);
		window.removeEventListener('blur', cancel);
	}
	function update() {
		if (!gesture) return;
		const root = container();
		if (!root) return;
		const y = gesture.y - root.getBoundingClientRect().top + root.scrollTop;
		// Hit-test the original rows so unequal heights cannot reverse a swap
		// merely because the local preview moved a row under the pointer.
		const target = gesture.rows.find((row) => y >= row.top && y <= row.bottom);
		if (!target) return;
		draft = reorderTrackList(gesture.source, gesture.id, target.id) ?? gesture.source;
	}
	function scroll() {
		if (!gesture || !draft) return;
		const root = container();
		if (root) {
			const bounds = root.getBoundingClientRect();
			const delta =
				gesture.y < bounds.top + SCROLL_EDGE
					? -SCROLL_SPEED
					: gesture.y > bounds.bottom - SCROLL_EDGE
						? SCROLL_SPEED
						: 0;
			if (delta) {
				root.scrollTop += delta;
				update();
			}
		}
		scrollFrame = requestAnimationFrame(scroll);
	}
	function move(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		if (timelineStore.tracks !== gesture.source) {
			cancel();
			return;
		}
		gesture.y = event.clientY;
		if (!draft && Math.abs(gesture.y - gesture.startY) < DRAG_THRESHOLD) return;
		if (!draft) {
			draft = gesture.source;
			scrollFrame = requestAnimationFrame(scroll);
		}
		update();
	}
	function drop(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		const { id, source } = gesture;
		const parentTrackId = source.find((track) => track.id === id)?.parentTrackId;
		const ordered = draft
			?.filter((track) => track.parentTrackId === parentTrackId)
			.toSorted((a, b) => a.order - b.order);
		const siblings = source
			.filter((track) => track.parentTrackId === parentTrackId)
			.toSorted((a, b) => a.order - b.order);
		const index = ordered?.findIndex((track) => track.id === id) ?? -1;
		const target = siblings[index];
		cancel();
		if (timelineStore.tracks === source && target && moveTrackTo(id, target.id)) onedit();
	}
	function keydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		cancel();
	}
	onDestroy(cancel);
	return {
		get tracks() {
			return draft ?? timelineStore.tracks;
		},
		start(event: PointerEvent, id: string) {
			if (event.button !== 0) return;
			cancel();
			const root = container();
			const track = timelineStore.tracks.find((track) => track.id === id);
			if (!root || !track) return;
			const rootTop = root.getBoundingClientRect().top;
			const siblings = new Set(
				timelineStore.tracks
					.filter((candidate) => candidate.parentTrackId === track.parentTrackId)
					.map((candidate) => candidate.id)
			);
			const rows = [...root.querySelectorAll<HTMLElement>('[data-track]')]
				.filter((row) => siblings.has(row.dataset.track!))
				.map((row) => {
					const bounds = row.getBoundingClientRect();
					return {
						id: row.dataset.track!,
						top: bounds.top - rootTop + root.scrollTop,
						bottom: bounds.bottom - rootTop + root.scrollTop
					};
				});
			event.preventDefault();
			event.stopPropagation();
			if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
			gesture = {
				id,
				pointerId: event.pointerId,
				startY: event.clientY,
				y: event.clientY,
				source: timelineStore.tracks,
				rows
			};
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', drop);
			window.addEventListener('pointercancel', cancel);
			window.addEventListener('keydown', keydown);
			window.addEventListener('blur', cancel);
		}
	};
}
