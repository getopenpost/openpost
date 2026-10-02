import { TimelineFrameRenderer } from '../media/render-export';
import type { Project } from '../project/types';
import PreviewLayer from './preview-layer.svelte';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { COMPOSITION_CONTROLS_VERSION } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import CompositionTimeline from './composition-timeline.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import SelectionFixture from './composition-selection.fixture.svelte';

it('seeks between Motion ruler labels using the same scale as the labels', async () => {
	const id = 'ruler-gap';
	sequenceStore.addComposition({
		id,
		name: 'Ruler gap',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 353
	});
	sequenceStore.switchTo(id);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const ruler = screen.getByTestId('composition-ruler').element();
		const ticks = Array.from(ruler.querySelectorAll<HTMLButtonElement>('button'));
		const first = ticks[0]!;
		const second = ticks[1]!;
		const a = Number(first.textContent);
		const b = Number(second.textContent);
		const x =
			(first.getBoundingClientRect().left +
				first.getBoundingClientRect().width / 2 +
				second.getBoundingClientRect().left +
				second.getBoundingClientRect().width / 2) /
			2;
		for (const type of ['pointerdown', 'pointerup']) {
			(type === 'pointerdown' ? ruler : window).dispatchEvent(
				new PointerEvent(type, {
					pointerId: 1,
					button: 0,
					bubbles: true,
					clientX: x,
					clientY: ruler.getBoundingClientRect().top + 5
				})
			);
		}
		expect(timelineStore.currentFrame).toBe(Math.round((a + b) / 2));
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(id);
	}
});

it('duplicates a Motion layer at the same time and selects the copy', async () => {
	const id = 'duplicate-motion';
	sequenceStore.addComposition({
		id,
		name: 'Duplicate',
		editorKind: 'composite-2d',
		items: [
			{
				id: 'title',
				type: 'text',
				text: 'Title',
				label: 'Title',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 300
			}
		],
		tracks: createDefaultTracks(),
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	});
	sequenceStore.switchTo(id);
	const onselectitem = vi.fn();
	try {
		const screen = await render(CompositionTimeline, {
			onedit: vi.fn(),
			onselectitem,
			selectedItemId: 'title'
		});
		await screen.getByTestId('composition-duplicate').click();
		expect(timelineStore.items).toHaveLength(2);
		const copy = timelineStore.items.find((item) => item.id !== 'title')!;
		expect(copy.from).toBe(0);
		expect(copy.durationInFrames).toBe(300);
		expect(copy.trackId).not.toBe('track-video-main');
		expect(onselectitem).toHaveBeenLastCalledWith(copy.id);
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(id);
	}
});

it('keeps all duplicated layers selected when the inspector receives the primary selection', async () => {
	const id = 'duplicate-selection';
	sequenceStore.addComposition({
		id,
		name: 'Selection',
		editorKind: 'composite-2d',
		items: ['first', 'second'].map((id, index) => ({
			id,
			label: id,
			text: id,
			type: 'text',
			trackId: index === 0 ? 'track-video-main' : 'track-video-overlay',
			from: 0,
			durationInFrames: 300
		})),
		tracks: createDefaultTracks(),
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	});
	sequenceStore.switchTo(id);
	try {
		const screen = await render(SelectionFixture);
		await screen.getByTestId('composition-layer-first').click();
		await userEvent.keyboard('{Shift>}');
		await screen.getByTestId('composition-layer-second').click();
		await userEvent.keyboard('{/Shift}');
		await screen.getByTestId('composition-duplicate').click();
		await screen.getByTestId('ruler-tick-0').click();
		const copies = timelineStore.items.filter((item) => !['first', 'second'].includes(item.id));
		expect(copies).toHaveLength(2);
		for (const copy of copies) {
			await expect
				.element(screen.getByTestId(`composition-layer-${copy.id}`))
				.toHaveAttribute('aria-pressed', 'true');
		}
		await expect
			.element(screen.getByTestId('composition-layer-first'))
			.toHaveAttribute('aria-pressed', 'false');
		await expect
			.element(screen.getByTestId('composition-layer-second'))
			.toHaveAttribute('aria-pressed', 'false');
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(id);
	}
});

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

it('keeps an explicit accessible name on composition control override fields while typing', async () => {
	const nestedId = 'composition-nested-control-label';
	const parentId = 'composition-parent-control-label';
	const instanceId = 'composition-instance-control-label';
	sequenceStore.addComposition({
		id: nestedId,
		name: 'Nested promo',
		editorKind: 'composite-2d',
		items: [
			{
				id: 'nested-text-control-label',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 60,
				label: 'Nested title',
				type: 'text',
				text: 'Hello',
				fontFamily: 'Inter',
				fontSize: 64,
				fontWeight: 700,
				color: '#ffffff',
				transform: { x: 0, y: 0, width: 960, height: 240 }
			}
		],
		tracks: createDefaultTracks(),
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60,
		compositionControls: {
			version: COMPOSITION_CONTROLS_VERSION,
			controls: [
				{
					id: 'ctrl-headline-label',
					name: 'Headline',
					targetItemId: 'nested-text-control-label',
					property: 'text.text',
					kind: 'text',
					defaultValue: 'Hello'
				}
			]
		}
	});
	sequenceStore.addComposition({
		id: parentId,
		name: 'Parent promo',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60
	});
	sequenceStore.switchTo(parentId);
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: instanceId,
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'Promo block',
			type: 'composition',
			compositionId: nestedId
		}
	]);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		screen.container
			.querySelector<HTMLButtonElement>(`[data-testid="layer-expand-${instanceId}"]`)!
			.click();
		const field = screen.getByRole('textbox', { name: 'Headline' });
		await expect.element(field).toHaveAttribute('aria-label', 'Headline');
		await field.fill('New headline');
		await expect.element(field).toHaveValue('New headline');
		await expect.element(field).toHaveAttribute('aria-label', 'Headline');
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(parentId);
		sequenceStore.deleteCompositionAndReferences(nestedId);
	}
});

it('exposes the composition dimensions strip as a named group', async () => {
	const compositionId = 'composition-meta-group';
	sequenceStore.addComposition({
		id: compositionId,
		name: 'Meta group',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60
	});
	sequenceStore.switchTo(compositionId);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const group = screen.getByRole('group', {
			name: m.video_editor_composition_timeline_meta()
		});
		await expect.element(group).toBeVisible();
		await expect.element(group.getByTestId('composition-fps')).toBeVisible();
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(compositionId);
	}
});

it('exposes the layer tools toolbar with its accessible name', async () => {
	const compositionId = 'composition-toolbar-label';
	sequenceStore.addComposition({
		id: compositionId,
		name: 'Toolbar label',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60
	});
	sequenceStore.switchTo(compositionId);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const toolbar = screen.getByRole('toolbar', {
			name: m.video_editor_composition_timeline_toolbar()
		});
		await expect.element(toolbar).toBeVisible();
		await expect.element(toolbar.getByTestId('add-layer-text')).toBeVisible();
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(compositionId);
	}
});

it('exposes the layer type badge as an image with the full type name', async () => {
	const compositionId = 'composition-layer-badge';
	sequenceStore.addComposition({
		id: compositionId,
		name: 'Badge label',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60
	});
	sequenceStore.switchTo(compositionId);
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'badge-text-item',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'Badge title',
			type: 'text',
			text: 'Hello',
			fontFamily: 'Inter',
			fontSize: 64,
			fontWeight: 700,
			color: '#ffffff',
			transform: { x: 0, y: 0, width: 960, height: 240 }
		}
	]);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const badge = screen.getByRole('img', { name: 'text' });
		await expect.element(badge).toBeVisible();
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(compositionId);
	}
});

it('exposes the composition work-area lane as a named group', async () => {
	const compositionId = 'composition-io-lane-group';
	sequenceStore.addComposition({
		id: compositionId,
		name: 'Work area group',
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
		const group = screen.getByRole('group', {
			name: m.video_editor_composition_timeline_range()
		});
		await expect.element(group).toBeVisible();
		await expect
			.element(group.getByText(m.video_editor_composition_timeline_full_range()))
			.toBeVisible();
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(compositionId);
	}
});

it('exposes the layer sidebar as a named group', async () => {
	const compositionId = 'composition-layer-sidebar-group';
	sequenceStore.addComposition({
		id: compositionId,
		name: 'Sidebar group',
		editorKind: 'composite-2d',
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60
	});
	sequenceStore.switchTo(compositionId);
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems([
		{
			id: 'sidebar-text-item',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'Sidebar title',
			type: 'text',
			text: 'Hello',
			fontFamily: 'Inter',
			fontSize: 64,
			fontWeight: 700,
			color: '#ffffff',
			transform: { x: 0, y: 0, width: 960, height: 240 }
		}
	]);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const group = screen.getByRole('group', {
			name: m.video_editor_composition_timeline_layers()
		});
		await expect.element(group).toBeVisible();
		await expect.element(group.getByTestId('layer-expand-sidebar-text-item')).toBeVisible();
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(compositionId);
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

it('aligns layer bars with measured sidebar rows after expanding and filtering', async () => {
	await page.viewport(1280, 900);
	const id = 'aligned-rows';
	sequenceStore.addComposition({
		id,
		name: 'Aligned',
		editorKind: 'composite-2d',
		items: ['first', 'second'].map((id, index) => ({
			id,
			label: id,
			type: 'text',
			text: id,
			trackId: index === 0 ? 'track-video-main' : 'track-video-overlay',
			from: 0,
			durationInFrames: 300
		})),
		tracks: createDefaultTracks(),
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	});
	sequenceStore.switchTo(id);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const alignment = (itemId: string) => {
			const label = screen
				.getByTestId(`composition-layer-${itemId}`)
				.element()
				.getBoundingClientRect();
			const bar = screen.getByTestId(`composition-bar-${itemId}`).element().getBoundingClientRect();
			return Math.abs(label.top + label.height / 2 - bar.top - bar.height / 2);
		};
		await expect.poll(() => alignment('second')).toBeLessThan(2);
		await screen.getByTestId('layer-expand-first').click();
		await expect.poll(() => alignment('second')).toBeLessThan(2);
		await screen.getByRole('textbox', { name: 'Filter layers' }).fill('second');
		await expect.element(screen.getByTestId('composition-bar-first')).not.toBeInTheDocument();
		await expect.poll(() => alignment('second')).toBeLessThan(2);
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(id);
	}
});

it('retains marquee selection after pointer release and its browser click', async () => {
	const id = 'review-motion';
	sequenceStore.addComposition({
		id,
		name: id,
		editorKind: 'composite-2d',
		items: [
			{
				id: 'title',
				label: 'Title',
				type: 'text',
				text: 'Title',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 30
			}
		],
		tracks: createDefaultTracks(),
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	});
	sequenceStore.switchTo(id);
	try {
		const screen = await render(CompositionTimeline, { onedit: vi.fn() });
		const bar = screen.getByTestId('composition-bar-title');
		const bars = screen.getByTestId('composition-layer-bars').element();
		const rect = bar.element().getBoundingClientRect();
		const pointer = (type: string, target: EventTarget, x: number, y: number) =>
			target.dispatchEvent(
				new PointerEvent(type, { pointerId: 1, button: 0, bubbles: true, clientX: x, clientY: y })
			);
		pointer('pointerdown', bars, rect.right + 20, rect.bottom + 10);
		pointer('pointermove', window, rect.left + 2, rect.top + 2);
		pointer('pointerup', window, rect.left + 2, rect.top + 2);
		await expect.element(bar).toHaveAttribute('aria-pressed', 'true');
		screen
			.getByTestId('composition-scroll')
			.element()
			.dispatchEvent(
				new MouseEvent('click', { bubbles: true, clientX: rect.left + 2, clientY: rect.top + 2 })
			);
		await expect.element(bar).toHaveAttribute('aria-pressed', 'true');
		// A fresh blank click still clears the completed selection.
		pointer('pointerdown', bars, rect.right + 20, rect.bottom + 10);
		pointer('pointerup', window, rect.right + 20, rect.bottom + 10);
		screen
			.getByTestId('composition-scroll')
			.element()
			.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await expect.element(bar).toHaveAttribute('aria-pressed', 'false');
		// Canceling another drag restores the empty selection from before the gesture.
		pointer('pointerdown', bars, rect.right + 20, rect.bottom + 10);
		pointer('pointermove', window, rect.left + 2, rect.top + 2);
		await expect.element(bar).toHaveAttribute('aria-pressed', 'true');
		pointer('pointercancel', window, rect.left + 2, rect.top + 2);
		await expect.element(bar).toHaveAttribute('aria-pressed', 'false');
	} finally {
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(id);
	}
});

it.each(['solid', 'gradient'] as const)(
	'renders the generated Motion %s without a media source',
	async (kind) => {
		const id = `generated-${kind}`;
		const composition = {
			id,
			name: 'Generated layer',
			editorKind: 'composite-2d' as const,
			items: [],
			tracks: [],
			transitions: [],
			fps: 30,
			width: 64,
			height: 64,
			durationInFrames: 30
		};
		sequenceStore.addComposition(composition);
		sequenceStore.switchTo(id);
		let renderer: TimelineFrameRenderer | undefined;
		try {
			const screen = await render(CompositionTimeline, { onedit: vi.fn() });
			await screen.getByTestId(`add-layer-${kind}`).click();
			const project: Project = {
				id: 'generated-layer',
				name: 'Generated layer',
				description: '',
				createdAt: 0,
				updatedAt: 0,
				duration: 1,
				metadata: { width: 64, height: 64, fps: 30 },
				timeline: { items: timelineStore.items, tracks: timelineStore.tracks, transitions: [] }
			};
			renderer = new TimelineFrameRenderer(project);
			const canvas = await renderer.render(0);
			const pixels = canvas.getContext('2d')!;
			const left = pixels.getImageData(1, 32, 1, 1).data;
			const right = pixels.getImageData(62, 32, 1, 1).data;
			expect(left[0]).toBeGreaterThan(240);
			expect(left[3]).toBe(255);
			const previewScreen = await render(PreviewLayer, {
				item: timelineStore.items[0]!,
				displayFrame: 0,
				canvasWidth: 64,
				canvasHeight: 64,
				selected: false,
				onselect: () => {}
			});
			const preview = previewScreen.container.querySelector('canvas')!;
			await expect
				.poll(() => preview.getContext('2d')!.getImageData(1, 32, 1, 1).data[0])
				.toBeGreaterThan(240);

			const previewRight = preview.getContext('2d')!.getImageData(62, 32, 1, 1).data;
			if (kind === 'solid') {
				expect(previewRight[0]).toBeGreaterThan(240);
				expect(previewRight[2]).toBeLessThan(80);
				expect(right[0]).toBeGreaterThan(240);
				expect(right[2]).toBeLessThan(80);
			} else {
				expect(previewRight[2]).toBeGreaterThan(240);
				expect(previewRight[0]).toBeLessThan(30);
				expect(right[2]).toBeGreaterThan(240);
				expect(right[0]).toBeLessThan(30);
			}
		} finally {
			renderer?.dispose();
			timelineStore.__resetForTesting();
			sequenceStore.deleteCompositionAndReferences(id);
		}
	}
);

it('keeps an existing Motion group intact when Group is repeated and undoes once', async () => {
	const id = 'motion-repeat-group';
	const tracks = ['a', 'b', 'c'].map((id, order) => ({
		id,
		name: id,
		order,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false
	}));
	const items = ['a', 'b', 'c'].map((id) => ({
		id,
		trackId: id,
		type: 'text' as const,
		text: id,
		label: id,
		from: 0,
		durationInFrames: 300
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
	const onedit = vi.fn();
	try {
		const screen = await render(SelectionFixture, { onedit });
		const first = screen.getByTestId('composition-layer-a');
		first.element().focus();
		await userEvent.keyboard('{Enter}');
		screen.getByTestId('composition-layer-b').element().focus();
		await userEvent.keyboard('{Control>}{Enter}{/Control}');
		await expect.element(first).toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(screen.getByTestId('composition-layer-b'))
			.toHaveAttribute('aria-pressed', 'true');
		await screen.getByTestId('composition-group').click();
		const initialGroup = timelineStore.tracks.find((track) => track.isGroup)!;
		expect(initialGroup).toBeDefined();
		first.element().focus();
		await userEvent.keyboard('{Control>}g{/Control}');
		expect(timelineStore.tracks.filter((track) => track.isGroup).map((track) => track.id)).toEqual([
			initialGroup.id
		]);
		expect(
			timelineStore.tracks
				.filter((track) => track.parentTrackId === initialGroup.id)
				.map((track) => track.id)
		).toEqual(['a', 'b']);
		expect(timelineStore.tracks.find((track) => track.id === 'c')?.parentTrackId).toBeUndefined();
		await expect.element(screen.getByTestId('composition-group')).toBeDisabled();
		expect(onedit).toHaveBeenCalledTimes(1);
		commandHistory.undo();
		expect(timelineStore.tracks).toEqual(tracks);
		commandHistory.redo();
		expect(timelineStore.tracks.filter((track) => track.isGroup).map((track) => track.id)).toEqual([
			initialGroup.id
		]);
		expect(timelineStore.items).toEqual(items);
		first.element().focus();
		await userEvent.keyboard('{Control>}a{/Control}');
		await screen.getByTestId('composition-group').click();
		const regrouped = timelineStore.tracks.filter((track) => track.isGroup);
		expect(regrouped).toHaveLength(1);
		expect(regrouped[0]!.id).not.toBe(initialGroup.id);
		expect(
			timelineStore.tracks
				.filter((track) => track.parentTrackId === regrouped[0]!.id)
				.map((track) => track.id)
		).toEqual(['a', 'b', 'c']);
		commandHistory.undo();
		expect(timelineStore.tracks.filter((track) => track.isGroup).map((track) => track.id)).toEqual([
			initialGroup.id
		]);
	} finally {
		commandHistory.clearHistory();
		timelineStore.__resetForTesting();
		sequenceStore.deleteCompositionAndReferences(id);
	}
});
