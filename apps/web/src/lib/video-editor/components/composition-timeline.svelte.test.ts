import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { COMPOSITION_CONTROLS_VERSION } from '$lib/video-editor/project/types';
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
