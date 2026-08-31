import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import '../../../routes/layout.css';
import MotionWorkspacePanel from './motion-workspace-panel.svelte';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	volume: 1,
	order: 0
};

const item: TimelineItem = {
	id: 'video',
	trackId: track.id,
	from: 0,
	durationInFrames: 60,
	label: 'Video',
	type: 'video',
	transform: { x: 0, y: 0, width: 1280, height: 720 }
};

const props = (itemId: string | null) => ({
	itemId,
	frameWidth: 1280,
	frameHeight: 720,
	fps: 30,
	onedit: vi.fn()
});

beforeEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
});

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('keeps motion work focused on the selected visual clip', async () => {
	const screen = await render(MotionWorkspacePanel, props(item.id));

	await expect.element(screen.getByRole('complementary', { name: 'Motion' })).toBeVisible();
	await expect
		.element(screen.getByRole('heading', { name: 'Transform', exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('heading', { name: 'Motion presets' })).toBeVisible();
});

test('shows a direct empty state without overflowing a phone viewport', async () => {
	await page.viewport(320, 720);
	const screen = await render(MotionWorkspacePanel, props(null));
	const panel = screen.getByRole('complementary', { name: 'Motion' }).element();

	await expect.element(screen.getByText('Select a visual clip first.')).toBeVisible();
	expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
});

test('parents the selected layer in place and exposes the current relationship', async () => {
	const parent: TimelineItem = {
		...item,
		id: 'parent',
		label: 'Parent layer',
		transform: { x: 100, y: 0, width: 1280, height: 720 }
	};
	timelineStore._setItems([item, parent]);
	const onedit = vi.fn();
	const screen = await render(MotionWorkspacePanel, { ...props(item.id), onedit });
	const select = screen.getByRole('button', { name: 'Parent layer' });

	await select.click();
	await screen.getByRole('option', { name: parent.label }).click();

	expect(timelineStore.itemById.get(item.id)?.transformParent?.parentItemId).toBe(parent.id);
	expect(onedit).toHaveBeenCalledOnce();
	await expect.element(select).toHaveTextContent(parent.label);
});

test('adds a non-rendering controller and selects it for editing', async () => {
	const onselectitem = vi.fn();
	const onedit = vi.fn();
	const screen = await render(MotionWorkspacePanel, {
		...props(item.id),
		itemIds: [item.id],
		onselectitem,
		onedit
	});

	await screen.getByRole('button', { name: 'Add controller' }).click();

	const controller = timelineStore.items.find((candidate) => candidate.type === 'controller');
	expect(controller).toMatchObject({ label: 'Controller', from: 0 });
	expect(onselectitem).toHaveBeenCalledWith(controller?.id);
	expect(onedit).toHaveBeenCalledOnce();
});
