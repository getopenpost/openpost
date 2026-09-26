import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import CompositionTimeline from './composition-timeline.svelte';

it('changes composition zoom through the accessible scalar slider', async () => {
	const previousZoom = timelineStore.zoomLevel;
	const compositionId = 'composition-zoom-test';
	sequenceStore.addComposition({
		id: compositionId,
		name: 'Zoom test',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 120
	});
	sequenceStore.switchTo(compositionId);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const slider = screen.getByRole('slider', {
			name: m.video_editor_composition_timeline_zoom()
		});
		slider.element().focus();
		await userEvent.keyboard('{ArrowRight}');

		await vi.waitFor(() => expect(timelineStore.zoomLevel).toBeGreaterThan(1));
	} finally {
		sequenceStore.deleteCompositionAndReferences(compositionId);
		timelineStore._setZoomLevel(previousZoom);
	}
});

it('toggles a motion layer once per modifier click and preserves a group for dragging', async () => {
	const id = 'motion-selection-test';
	const tracks = ['a', 'b'].map((id, order) => ({
		id,
		name: id,
		order,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false
	}));
	const items = ['a', 'b'].map((id) => ({
		id,
		trackId: id,
		type: 'text' as const,
		text: id,
		label: id,
		color: '#ffffff',
		from: 30,
		durationInFrames: 90
	}));
	sequenceStore.addComposition({
		id,
		name: id,
		editorKind: 'composite-2d',
		items,
		tracks,
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	});
	sequenceStore.switchTo(id);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const first = screen.getByTestId('composition-bar-a');
		const second = screen.getByTestId('composition-bar-b');
		await first.click();
		await userEvent.keyboard('{Control>}');
		await second.click();
		await userEvent.keyboard('{/Control}');
		await expect.element(first).toHaveAttribute('aria-pressed', 'true');
		await expect.element(second).toHaveAttribute('aria-pressed', 'true');
		const element = first.element();
		const rect = element.getBoundingClientRect();
		const pointer = (type: string, target: EventTarget, offset: number) =>
			target.dispatchEvent(
				new PointerEvent(type, {
					pointerId: 1,
					button: 0,
					bubbles: true,
					cancelable: true,
					clientX: rect.left + rect.width / 2 + offset,
					clientY: rect.top + rect.height / 2
				})
			);
		pointer('pointerdown', element, 0);
		pointer('pointermove', window, 15);
		await new Promise(requestAnimationFrame);
		pointer('pointermove', window, 30);
		pointer('pointerup', window, 30);
		expect(timelineStore.items[0]!.from).toBeGreaterThan(30);
		expect(timelineStore.items[1]!.from).toBe(timelineStore.items[0]!.from);
		await expect.element(first).toHaveAttribute('aria-pressed', 'true');
		await expect.element(second).toHaveAttribute('aria-pressed', 'true');

		timelineStore._setTracks(tracks.map((track) => ({ ...track, locked: true })));
		await first.click();
		await expect.element(first).toHaveAttribute('aria-pressed', 'true');
		await expect.element(second).toHaveAttribute('aria-pressed', 'false');
	} finally {
		sequenceStore.deleteCompositionAndReferences(id);
	}
});

it.each(['start', 'end'])(
	'keeps linked source boundaries aligned through repeated %s trim moves',
	async (edge) => {
		const id = `motion-trim-${edge}`;
		const tracks = ['a', 'b'].map((id, order) => ({
			id,
			name: id,
			order,
			height: 64,
			kind: 'video' as const,
			locked: false,
			visible: true,
			muted: false,
			solo: false
		}));
		const items = ['a', 'b'].map((id) => ({
			id,
			trackId: id,
			type: 'video' as const,
			label: id,
			from: 30,
			durationInFrames: 90,
			sourceStart: 30,
			sourceEnd: 120,
			sourceDuration: 300,
			sourceFps: 30,
			linkedGroupId: 'pair'
		}));
		sequenceStore.addComposition({
			id,
			name: id,
			editorKind: 'composite-2d',
			items,
			tracks,
			transitions: [],
			fps: 30,
			width: 1920,
			height: 1080,
			durationInFrames: 300
		});
		sequenceStore.switchTo(id);
		timelineStore._setSnapEnabled(false);
		try {
			const screen = await render(CompositionTimeline, { onedit: vi.fn() });
			const element = screen.getByTestId('composition-bar-a').element();
			const rect = element.getBoundingClientRect();
			const x = edge === 'start' ? rect.left + 2 : rect.right - 2;
			const pointer = (type: string, target: EventTarget, frames: number) =>
				target.dispatchEvent(
					new PointerEvent(type, {
						pointerId: 1,
						button: 0,
						bubbles: true,
						cancelable: true,
						clientX: x + (frames * rect.width) / 90,
						clientY: rect.top + rect.height / 2
					})
				);
			pointer('pointerdown', element, 0);
			pointer('pointermove', window, 5);
			await new Promise(requestAnimationFrame);
			pointer('pointermove', window, 10);
			pointer('pointerup', window, 10);
			for (const item of timelineStore.items) {
				expect(item.sourceStart).toBe(edge === 'start' ? 40 : 30);
				expect(item.sourceEnd).toBe(edge === 'end' ? 130 : 120);
				expect(item.durationInFrames).toBe(edge === 'start' ? 80 : 100);
			}
		} finally {
			sequenceStore.deleteCompositionAndReferences(id);
		}
	}
);
