import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
import { editPreviewStore } from '$lib/video-editor/preview/edit-preview-store.svelte';
import EditPreviewOverlay from './edit-preview-overlay.svelte';
import TimelinePanel from './timeline-panel.svelte';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';

function track(id: string, kind: TimelineTrack['kind'], order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function videoItem(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 60,
		label: 'Video',
		type: 'video',
		sourceStart: 0,
		sourceEnd: 60,
		sourceDuration: 180,
		sourceFps: 30,
		speed: 1,
		...overrides
	};
}

async function nextFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function dispatchPointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	clientX: number,
	opts: { shiftKey?: boolean; altKey?: boolean; clientY?: number } = {}
): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX,
			clientY: opts.clientY ?? 0,
			pointerId: 7,
			shiftKey: opts.shiftKey ?? false,
			altKey: opts.altKey ?? false
		})
	);
}

function clipElement(container: HTMLElement, id: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[data-timeline-item-id="${id}"]`);
	if (!el) throw new Error(`clip ${id} not found`);
	return el;
}

beforeEach(() => {
	editPreviewStore.__resetForTesting();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.setAll([]);
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [],
		fps: 30
	});
});

describe('edit preview overlay pointer integration', () => {
	it('shows rolling 2-up OUT/IN and updates via snapped plan', async () => {
		const left = videoItem({
			id: 'left',
			from: 0,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60,
			label: 'left'
		});
		const right = videoItem({
			id: 'right',
			from: 60,
			durationInFrames: 60,
			sourceStart: 60,
			sourceEnd: 120,
			label: 'right'
		});
		timelineStore.setAll({ items: [left, right], tracks: [track('video-track', 'video', 0)] });
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const leftEl = clipElement(screen.container as HTMLElement, 'left');
		const trimEnd = leftEl.querySelector<HTMLButtonElement>('button[aria-label="Trim clip end"]')!;
		expect(trimEnd).not.toBeNull();
		dispatchPointer(trimEnd, 'pointerdown', 400, { altKey: true });
		dispatchPointer(window, 'pointermove', 420);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).toBeVisible();
		const panels = overlayHost.container.querySelectorAll('[data-testid="edit-preview-panel"]');
		expect(panels).toHaveLength(2);
		expect(panels[0]?.getAttribute('data-edit-preview-label')).toBe('OUT');
		expect(panels[1]?.getAttribute('data-edit-preview-label')).toBe('IN');
		const leftOut = panels[0]?.getAttribute('data-edit-preview-frame');
		const rightIn = panels[1]?.getAttribute('data-edit-preview-frame');
		expect(leftOut).toBe('64');
		expect(rightIn).toBe('65');
		const beforeLen = commandHistory.undoStack.length;
		dispatchPointer(window, 'pointerup', 420);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
		expect(commandHistory.undoStack.length).toBe(beforeLen + 1);
		expect(commandHistory.getLastCommandType()).toBe('ROLLING_EDIT');
	});

	it('shows ripple 2-up and GAP when next not adjacent', async () => {
		const anchor = videoItem({ id: 'anchor', from: 0, durationInFrames: 60, label: 'anchor' });
		const far = videoItem({ id: 'far', from: 120, durationInFrames: 60, label: 'far' });
		timelineStore.setAll({ items: [anchor, far], tracks: [track('video-track', 'video', 0)] });
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const anchorEl = clipElement(screen.container as HTMLElement, 'anchor');
		const trimEnd = anchorEl.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		)!;
		dispatchPointer(trimEnd, 'pointerdown', 400, { shiftKey: true });
		dispatchPointer(window, 'pointermove', 380);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).toBeVisible();
		const panels = overlayHost.container.querySelectorAll('[data-testid="edit-preview-panel"]');
		expect(panels[0]?.getAttribute('data-edit-preview-label')).toBe('OUT');
		const gap = overlayHost.container.querySelector('[data-edit-preview-gap="true"]');
		expect(gap).not.toBeNull();
		expect(gap?.textContent).toBe('GAP');
		dispatchPointer(window, 'pointerup', 380);
		await nextFrame();
	});

	it('slip shows new IN/OUT plus baseline corners with distinct frames', async () => {
		const clip = videoItem({
			id: 'slip-clip',
			from: 0,
			durationInFrames: 60,
			sourceStart: 30,
			sourceEnd: 90,
			label: 'slip-clip'
		});
		timelineStore.setAll({ items: [clip], tracks: [track('video-track', 'video', 0)] });
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await screen.getByRole('menuitemcheckbox', { name: 'Slip clip source' }).click();
		const clipBtn = screen.getByRole('button', { name: /slip-clip/ }).element();
		dispatchPointer(clipBtn, 'pointerdown', 200);
		dispatchPointer(window, 'pointermove', 220);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).toBeVisible();
		expect(
			overlayHost
				.getByTestId('edit-preview-overlay')
				.element()
				.getAttribute('data-edit-preview-kind')
		).toBe('slip');
		const mains = overlayHost.container.querySelectorAll('[data-testid="edit-preview-panel"]');
		const baselines = overlayHost.container.querySelectorAll(
			'[data-testid="edit-preview-baseline"]'
		);
		expect(mains.length).toBe(2);
		expect(baselines.length).toBe(2);
		expect(mains[0]?.getAttribute('data-edit-preview-label')).toBe('IN');
		expect(baselines[0]?.getAttribute('data-edit-preview-label')).toBe('IN');
		const newItem = timelineStore.itemById.get('slip-clip');
		expect(newItem?.sourceStart).not.toBe(30);
		dispatchPointer(window, 'pointerup', 220);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
	});

	it('slide shows left OUT and right IN as main plus baseline corners', async () => {
		const left = videoItem({
			id: 'left',
			from: 0,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60,
			label: 'left'
		});
		const center = videoItem({
			id: 'center',
			from: 60,
			durationInFrames: 60,
			sourceStart: 60,
			sourceEnd: 120,
			label: 'center'
		});
		const right = videoItem({
			id: 'right',
			from: 120,
			durationInFrames: 60,
			sourceStart: 120,
			sourceEnd: 180,
			label: 'right'
		});
		timelineStore.setAll({
			items: [left, center, right],
			tracks: [track('video-track', 'video', 0)]
		});
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await screen
			.getByRole('menuitemcheckbox', { name: 'Slide clip between adjacent edits' })
			.click();
		const centerBtn = screen.getByRole('button', { name: /center/ }).element();
		dispatchPointer(centerBtn, 'pointerdown', 300);
		dispatchPointer(window, 'pointermove', 320);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).toBeVisible();
		expect(
			overlayHost
				.getByTestId('edit-preview-overlay')
				.element()
				.getAttribute('data-edit-preview-kind')
		).toBe('slide');
		const mains = overlayHost.container.querySelectorAll('[data-testid="edit-preview-panel"]');
		expect(mains[0]?.getAttribute('data-edit-preview-label')).toBe('OUT');
		expect(mains[1]?.getAttribute('data-edit-preview-label')).toBe('IN');
		const baselines = overlayHost.container.querySelectorAll(
			'[data-testid="edit-preview-baseline"]'
		);
		expect(baselines.length).toBe(2);
		dispatchPointer(window, 'pointerup', 320);
		await nextFrame();
	});

	it('resolves audio-linked visual for rolling', async () => {
		const video = videoItem({
			id: 'video',
			trackId: 'video-track',
			linkedGroupId: 'g',
			from: 0,
			label: 'video'
		});
		const audio = videoItem({
			id: 'audio',
			trackId: 'audio-track',
			type: 'audio',
			linkedGroupId: 'g',
			from: 0,
			durationInFrames: 60,
			label: 'audio'
		});
		const right = videoItem({ id: 'right', from: 60, durationInFrames: 60, label: 'right' });
		timelineStore.setAll({
			items: [video, audio, right],
			tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)]
		});
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const videoEl = clipElement(screen.container as HTMLElement, 'video');
		const trimEnd = videoEl.querySelector<HTMLButtonElement>('button[aria-label="Trim clip end"]')!;
		dispatchPointer(trimEnd, 'pointerdown', 400, { altKey: true });
		dispatchPointer(window, 'pointermove', 420);
		await nextFrame();
		const panels = overlayHost.container.querySelectorAll('[data-testid="edit-preview-panel"]');
		expect(panels[0]?.getAttribute('data-edit-preview-frame')).toBe('64');
		dispatchPointer(window, 'pointerup', 420);
		await nextFrame();
	});

	it('cancels on Escape without extra undo and clears overlay', async () => {
		const left = videoItem({ id: 'left', from: 0, durationInFrames: 60, label: 'left' });
		const right = videoItem({ id: 'right', from: 60, durationInFrames: 60, label: 'right' });
		timelineStore.setAll({ items: [left, right], tracks: [track('video-track', 'video', 0)] });
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const leftEl = clipElement(screen.container as HTMLElement, 'left');
		const trimEnd = leftEl.querySelector<HTMLButtonElement>('button[aria-label="Trim clip end"]')!;
		dispatchPointer(trimEnd, 'pointerdown', 400, { altKey: true });
		dispatchPointer(window, 'pointermove', 420);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).toBeVisible();
		const beforeLen = commandHistory.undoStack.length;
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
		expect(timelineStore.itemById.get('left')?.durationInFrames).toBe(60);
		expect(timelineStore.itemById.get('right')?.durationInFrames).toBe(60);
		expect(commandHistory.undoStack.length).toBe(beforeLen);
	});

	it('cancels on pointercancel and clears overlay', async () => {
		const left = videoItem({ id: 'left', from: 0, durationInFrames: 60, label: 'left' });
		const right = videoItem({ id: 'right', from: 60, durationInFrames: 60, label: 'right' });
		timelineStore.setAll({ items: [left, right], tracks: [track('video-track', 'video', 0)] });
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const leftEl = clipElement(screen.container as HTMLElement, 'left');
		const trimEnd = leftEl.querySelector<HTMLButtonElement>('button[aria-label="Trim clip end"]')!;
		dispatchPointer(trimEnd, 'pointerdown', 400, { altKey: true });
		dispatchPointer(window, 'pointermove', 420);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).toBeVisible();
		window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 }));
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
	});

	it('click without drag never shows overlay', async () => {
		const left = videoItem({ id: 'left', from: 0, durationInFrames: 60, label: 'left' });
		const right = videoItem({ id: 'right', from: 60, durationInFrames: 60, label: 'right' });
		timelineStore.setAll({ items: [left, right], tracks: [track('video-track', 'video', 0)] });
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const leftEl = clipElement(screen.container as HTMLElement, 'left');
		const trimEnd = leftEl.querySelector<HTMLButtonElement>('button[aria-label="Trim clip end"]')!;
		dispatchPointer(trimEnd, 'pointerdown', 400, { altKey: true });
		dispatchPointer(window, 'pointerup', 400);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
		expect(commandHistory.undoStack.length).toBe(0);
	});

	it('rejected rolling and slip plans do not publish overlay', async () => {
		const clip = videoItem({
			id: 'clip',
			from: 0,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60,
			label: 'clip'
		});
		timelineStore.setAll({ items: [clip], tracks: [track('video-track', 'video', 0)] });
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await screen.getByRole('menuitemcheckbox', { name: 'Slip clip source' }).click();
		const clipBtn = screen.getByRole('button', { name: /^clip\./ }).element();
		dispatchPointer(clipBtn, 'pointerdown', 200);
		dispatchPointer(window, 'pointermove', 220);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
		dispatchPointer(window, 'pointerup', 220);
		await nextFrame();
		const left = videoItem({ id: 'left', from: 0, durationInFrames: 30, label: 'left' });
		const far = videoItem({ id: 'far', from: 100, durationInFrames: 30, label: 'far' });
		timelineStore.setAll({ items: [left, far], tracks: [track('video-track', 'video', 0)] });
		const screen2 = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost2 = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const leftEl2 = clipElement(screen2.container as HTMLElement, 'left');
		const trimEnd2 = leftEl2.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		)!;
		dispatchPointer(trimEnd2, 'pointerdown', 400, { altKey: true });
		dispatchPointer(window, 'pointermove', 420);
		await nextFrame();
		await expect.element(overlayHost2.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
		dispatchPointer(window, 'pointerup', 420);
		await nextFrame();
	});

	it('fully clamped slide and ripple edits do not publish overlay', async () => {
		const left = videoItem({ id: 'left', from: 0, durationInFrames: 1, label: 'left' });
		const center = videoItem({ id: 'center', from: 1, durationInFrames: 60, label: 'center' });
		const right = videoItem({ id: 'right', from: 61, durationInFrames: 1, label: 'right' });
		timelineStore.setAll({
			items: [left, center, right],
			tracks: [track('video-track', 'video', 0)]
		});
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		await screen.getByRole('button', { name: 'More actions' }).first().click();
		await screen
			.getByRole('menuitemcheckbox', { name: 'Slide clip between adjacent edits' })
			.click();
		const centerBtn = screen.getByRole('button', { name: /^center\./ }).element();
		dispatchPointer(centerBtn, 'pointerdown', 300);
		dispatchPointer(window, 'pointermove', 320);
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
		dispatchPointer(window, 'pointerup', 320);
		await nextFrame();
		const anchor = videoItem({
			id: 'anchor',
			from: 0,
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60,
			sourceDuration: 60,
			label: 'anchor'
		});
		const next = videoItem({ id: 'next', from: 60, durationInFrames: 60, label: 'next' });
		timelineStore.setAll({ items: [anchor, next], tracks: [track('video-track', 'video', 0)] });
		const screen2 = await render(TimelinePanel, { onedit: vi.fn() });
		const overlayHost2 = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// SAFETY: browser test container is HTMLElement
		const anchorEl = clipElement(screen2.container as HTMLElement, 'anchor');
		const trimEnd = anchorEl.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		)!;
		dispatchPointer(trimEnd, 'pointerdown', 400, { shiftKey: true });
		dispatchPointer(window, 'pointermove', 420);
		await nextFrame();
		await expect.element(overlayHost2.getByTestId('edit-preview-overlay')).not.toBeInTheDocument();
		dispatchPointer(window, 'pointerup', 420);
		await nextFrame();
	});

	it('works at 320px without overflow', async () => {
		await page.viewport(320, 720);
		const clip = videoItem({ id: 'clip', from: 0, durationInFrames: 60, label: 'clip' });
		timelineStore.setAll({ items: [clip], tracks: [track('video-track', 'video', 0)] });
		const overlayHost = await render(EditPreviewOverlay, {
			canvasWidth: 1920,
			canvasHeight: 1080,
			urls: {},
			proxyUrls: {}
		});
		// Force overlay visible via store
		editPreviewStore.__setForTesting({
			kind: 'slip',
			anchorId: 'clip',
			baseline: { clip },
			revision: 1
		});
		await nextFrame();
		await expect.element(overlayHost.getByTestId('edit-preview-overlay')).toBeVisible();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth + 1
		);
		// SAFETY: browser test container is HTMLElement
		const overlayEl = overlayHost.getByTestId('edit-preview-overlay').element() as HTMLElement;
		const rect = overlayEl.getBoundingClientRect();
		expect(rect.width).toBeLessThanOrEqual(320);
		await page.viewport(1280, 800);
		editPreviewStore.__resetForTesting();
	});
});
