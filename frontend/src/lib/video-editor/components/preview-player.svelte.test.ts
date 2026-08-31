import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { editorSession } from '../editor.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { TimelineFrameRenderer } from '../media/render-export';
import PreviewPlayer from './preview-player.svelte';
import { colorPreviewStore } from '../effects/color-preview-store.svelte';
import { scopeSamples } from '../effects/scope-samples.svelte';
import { adaptivePreviewQuality } from '../preview/adaptive-preview-quality.svelte';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import { previewDiagnostics } from '../preview/diagnostics.svelte';
import { timelinePreviewScrub } from '../preview/timeline-preview-scrub';
import { spatialEffectEditorStore } from '../preview/spatial-effect-editor.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createTransformParentBinding } from '../timeline/transform-parenting';
import { resolveAnimatedItemAt } from '../timeline/animated-properties';
import { createMotionAnimationLayer } from '../timeline/motion-layer-eval';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { updateProjectCanvas } from '../project/canvas-settings';
import { editorSettings } from '../settings/editor-settings.svelte';
import { keyboardShortcuts } from '../settings/keyboard-shortcuts.svelte';

function track(id: string, order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function colorLayer(id: string, trackId: string, backgroundColor: string): TimelineItem {
	return {
		id,
		trackId,
		from: 0,
		durationInFrames: 30,
		label: id,
		type: 'text',
		text: ' ',
		backgroundColor,
		transform: { width: 4, height: 4 }
	};
}

function blendProject(): Project {
	const bottom = colorLayer('bottom', 'bottom-track', '#808080');
	const top = {
		...colorLayer('top', 'top-track', '#808080'),
		blendMode: 'multiply' as const
	};
	return {
		id: 'blend-project',
		name: 'Blend project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 4, height: 4, fps: 30, backgroundColor: '#000000' },
		timeline: {
			tracks: [track('top-track', 0), track('bottom-track', 1)],
			items: [bottom, top]
		}
	};
}

function maskedProject(): Project {
	const content = colorLayer('content', 'content-track', '#ff0000');
	content.transform = { width: 8, height: 8 };
	const mask: TimelineItem = {
		id: 'mask',
		trackId: 'mask-track',
		from: 0,
		durationInFrames: 30,
		label: 'Mask',
		type: 'shape',
		shapeType: 'circle',
		isMask: true,
		maskType: 'clip',
		maskOpacity: 100,
		transform: { width: 4, height: 4 }
	};
	return {
		id: 'masked-project',
		name: 'Masked project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 8, height: 8, fps: 30, backgroundColor: '#0000ff' },
		timeline: {
			tracks: [track('mask-track', 0), track('content-track', 1)],
			items: [content, mask]
		}
	};
}

function cornerPinnedProject(): Project {
	const content = colorLayer('content', 'content-track', '#ff0000');
	content.transform = { width: 8, height: 8 };
	content.cornerPin = {
		topLeft: [2, 0],
		topRight: [0, 0],
		bottomRight: [0, 0],
		bottomLeft: [2, 0],
		referenceWidth: 8,
		referenceHeight: 8
	};
	return {
		id: 'corner-pin-project',
		name: 'Corner pin project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 8, height: 8, fps: 30, backgroundColor: '#0000ff' },
		timeline: { tracks: [track('content-track', 0)], items: [content] }
	};
}

function diagnosticVideoProject(): Project {
	const item: TimelineItem = {
		id: 'clip-12345678',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 30,
		label: 'Private clip name',
		type: 'video',
		mediaId: 'private-media-id',
		sourceStart: 5,
		sourceEnd: 35,
		sourceDuration: 60,
		speed: 1.5
	};
	return {
		id: 'diagnostic-project',
		name: 'Private project name',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: {
			width: 1920,
			height: 1080,
			fps: 30,
			backgroundColor: '#000000'
		},
		timeline: { tracks: [track('video-track', 0)], items: [item] }
	};
}

function centerPixel(canvas: HTMLCanvasElement | OffscreenCanvas): number[] {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return Array.from(
		context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
	);
}

afterEach(async () => {
	await page.viewport(1280, 900);
	colorPreviewStore.__resetForTesting();
	adaptivePreviewQuality.reset();
	previewPlaybackSettings.setPreviewQuality('auto');
	previewDiagnostics.setPerformanceOverlay(false);
	previewDiagnostics.setClipTimingOverlay(false);
	previewDiagnostics.resetCounters();
	previewDiagnostics.setPlaying(false);
	timelinePreviewScrub.__resetForTesting();
	spatialEffectEditorStore.__resetForTesting();
	commandHistory.clearHistory();
	editorSettings.reset();
	keyboardShortcuts.resetAll();
	editorSession.project = null;
	timelineStore.clear();
});

function gradedProject(): Project {
	const layer = {
		...colorLayer('graded', 'video-track', '#808080'),
		effects: [
			{
				id: 'grade',
				type: 'gpu' as const,
				effectId: 'gpu-brightness',
				enabled: true,
				params: { amount: 0.25 }
			}
		]
	};
	return {
		id: 'graded-project',
		name: 'Graded project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 4, height: 4, fps: 30, backgroundColor: '#000000' },
		timeline: { tracks: [track('video-track', 0)], items: [layer] }
	};
}

describe('PreviewPlayer backdrop composition', () => {
	it('keeps the canvas magnet independent from timeline snapping', async () => {
		await page.viewport(1000, 700);
		const bottom = colorLayer('bottom', 'bottom-track', '#ff0000');
		const top = colorLayer('top', 'top-track', '#0000ff');
		bottom.transform = { x: -100, y: 0, width: 100, height: 100 };
		top.transform = { x: 100, y: 0, width: 100, height: 100 };
		const project: Project = {
			id: 'independent-snap-project',
			name: 'Independent snap project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: {
				width: 800,
				height: 400,
				fps: 30,
				backgroundColor: '#000000'
			},
			timeline: {
				tracks: [track('top-track', 0), track('bottom-track', 1)],
				items: [bottom, top]
			}
		};
		editorSession.project = project;
		timelineStore.setAll({
			items: [bottom, top],
			tracks: project.timeline!.tracks,
			currentFrame: 0,
			fps: 30
		});
		timelineStore._setSnapEnabled(false);
		editorSettings.set('canvasSnapEnabled', true);

		const screen = await render(PreviewPlayer, {
			selectedItemId: top.id,
			selectedItemIds: [bottom.id, top.id],
			onedit: vi.fn()
		});
		const canvasMagnet = screen.getByRole('button', {
			name: 'Disable canvas snapping (Shift+S)'
		});
		await expect.element(canvasMagnet).toHaveAttribute('aria-pressed', 'true');
		await canvasMagnet.click();

		expect(editorSettings.canvasSnapEnabled).toBe(false);
		expect(timelineStore.snapEnabled).toBe(false);
		await expect
			.element(
				screen.getByRole('button', {
					name: 'Enable canvas snapping (Shift+S)'
				})
			)
			.toHaveAttribute('aria-pressed', 'false');
	});

	it('clears the visual selection from empty preview space', async () => {
		await page.viewport(1000, 700);
		const item = colorLayer('selected', 'video-track', '#ff0000');
		item.transform = { width: 120, height: 80 };
		const project: Project = {
			id: 'preview-deselect-project',
			name: 'Preview deselect project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: {
				width: 800,
				height: 400,
				fps: 30,
				backgroundColor: '#000000'
			},
			timeline: { tracks: [track('video-track', 0)], items: [item] }
		};
		editorSession.project = project;
		sequenceStore.load(project.timeline!, project.metadata);
		timelineStore.setAll({
			items: [item],
			tracks: project.timeline!.tracks,
			currentFrame: 0,
			fps: 30
		});
		const ondeselect = vi.fn();
		const screen = await render(PreviewPlayer, {
			selectedItemId: item.id,
			selectedItemIds: [item.id],
			ondeselect,
			onedit: vi.fn()
		});
		screen.container.style.width = '900px';
		screen.container.style.height = '600px';

		await expect.element(screen.getByRole('button', { name: 'Move selected clip' })).toBeVisible();
		const pasteboard = screen.container.querySelector<HTMLElement>('[data-program-pasteboard]');
		expect(pasteboard).not.toBeNull();
		pasteboard!.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				clientX: 2,
				clientY: 2
			})
		);

		await expect
			.element(screen.getByRole('button', { name: 'Move selected clip' }))
			.not.toBeInTheDocument();
		expect(ondeselect).toHaveBeenCalledOnce();
	});

	it('selects a buried overlapping layer from the canvas context menu', async () => {
		await page.viewport(1000, 700);
		const bottom = colorLayer('bottom', 'bottom-track', '#ff0000');
		const top = colorLayer('top', 'top-track', '#0000ff');
		bottom.label = 'Bottom layer';
		top.label = 'Top layer';
		bottom.transform = { x: 0, y: 0, width: 300, height: 200 };
		top.transform = { x: 0, y: 0, width: 120, height: 120, rotation: 20 };
		const project: Project = {
			id: 'layer-picker-project',
			name: 'Layer picker project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: {
				width: 800,
				height: 400,
				fps: 30,
				backgroundColor: '#000000'
			},
			timeline: {
				tracks: [track('top-track', 0), track('bottom-track', 1)],
				items: [bottom, top]
			}
		};
		editorSession.project = project;
		sequenceStore.load(project.timeline!, project.metadata);
		timelineStore.setAll({
			items: [bottom, top],
			tracks: project.timeline!.tracks,
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, {
			selectedItemId: top.id,
			selectedItemIds: [top.id],
			onedit: vi.fn()
		});
		screen.container.style.width = '900px';
		screen.container.style.height = '600px';
		const monitor = screen.getByRole('application', { name: 'Program' });
		await expect.element(monitor).toBeVisible();

		await userEvent.click(monitor, {
			button: 'right',
			position: { x: 400, y: 200 }
		});
		await expect.element(screen.getByRole('menuitem', { name: /^Top layer/ })).toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: /^Bottom layer/ })).toBeVisible();
		await screen.getByRole('menuitem', { name: /^Bottom layer/ }).click();

		await userEvent.click(monitor, {
			button: 'right',
			position: { x: 400, y: 200 }
		});
		expect(screen.getByRole('menuitem', { name: /^Bottom layer/ }).element()).toHaveAttribute(
			'aria-current',
			'true'
		);
		await userEvent.keyboard('{Escape}');

		monitor.element().focus();
		await userEvent.keyboard('{Shift>}{F10}{/Shift}');
		await expect.element(screen.getByRole('menuitem', { name: /^Top layer/ })).toBeVisible();
	});

	it('resizes the program monitor with project canvas undo and redo', async () => {
		const project: Project = {
			id: 'canvas-project',
			name: 'Canvas project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0,
			metadata: {
				width: 1920,
				height: 1080,
				fps: 30,
				backgroundColor: '#000000'
			},
			timeline: { tracks: [], items: [] }
		};
		editorSession.project = project;
		sequenceStore.load(project.timeline!, project.metadata);
		const screen = await render(PreviewPlayer, {
			selectedItemId: null,
			onedit: vi.fn()
		});
		const monitor = screen.container.querySelector<HTMLElement>('[data-program-monitor]');
		expect(monitor).not.toBeNull();
		if (!monitor) return;
		expect(monitor.style.aspectRatio).toBe('1920 / 1080');

		expect(updateProjectCanvas({ width: 1080, height: 1920 })).toBe(true);
		await vi.waitFor(() => expect(monitor.style.aspectRatio).toBe('1080 / 1920'));
		commandHistory.undo();
		await vi.waitFor(() => expect(monitor.style.aspectRatio).toBe('1920 / 1080'));
		commandHistory.redo();
		await vi.waitFor(() => expect(monitor.style.aspectRatio).toBe('1080 / 1920'));
	});

	it('commits a layered canvas move to the editable base without double-counting motion', async () => {
		await page.viewport(1000, 700);
		const item = colorLayer('layered', 'video-track', '#ff0000');
		item.transform = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
		item.motionLayers = [
			createMotionAnimationLayer({
				name: 'Offset',
				source: 'built-in-preset',
				sourcePresetId: 'slide-in-left',
				anchor: {
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					rotation: 0,
					opacity: 1
				},
				payloads: [{ property: 'x', frame: 0, value: 20, easing: 'linear' }]
			})
		];
		const project: Project = {
			id: 'layered-canvas-project',
			name: 'Layered canvas project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: {
				width: 800,
				height: 400,
				fps: 30,
				backgroundColor: '#000000'
			},
			timeline: { tracks: [track('video-track', 0)], items: [item] }
		};
		editorSession.project = project;
		timelineStore.setAll({
			items: [item],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(PreviewPlayer, {
			selectedItemId: item.id,
			onedit
		});
		screen.container.style.width = '800px';
		screen.container.style.height = '500px';

		const move = screen.getByRole('button', { name: 'Move selected clip' });
		await expect.element(move).toBeVisible();
		move
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

		expect(timelineStore.itemById.get(item.id)?.transform?.x).toBe(1);
		expect(
			resolveAnimatedItemAt(timelineStore.itemById.get(item.id)!, 0, {
				fps: 30,
				frameWidth: 800,
				frameHeight: 400,
				items: timelineStore.items
			}).transform?.x
		).toBe(21);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get(item.id)?.transform?.x).toBe(0);
		expect(
			resolveAnimatedItemAt(timelineStore.itemById.get(item.id)!, 0, {
				fps: 30,
				frameWidth: 800,
				frameHeight: 400,
				items: timelineStore.items
			}).transform?.x
		).toBe(20);
	});

	it('wires multi-selection transforms through one atomic timeline command', async () => {
		await page.viewport(1000, 700);
		commandHistory.clearHistory();
		const bottom = colorLayer('bottom', 'bottom-track', '#ff0000');
		const top = colorLayer('top', 'top-track', '#0000ff');
		bottom.transform = { x: -100, y: 0, width: 100, height: 100 };
		top.transform = { x: 100, y: 0, width: 100, height: 100 };
		const parentPose = {
			x: -100,
			y: 0,
			width: 100,
			height: 100,
			anchorX: 50,
			anchorY: 50,
			rotation: 0,
			opacity: 1,
			cornerRadius: 0
		};
		const childPose = { ...parentPose, x: 100 };
		top.transformParent = createTransformParentBinding({
			childLocal: childPose,
			childWorld: childPose,
			parentItemId: bottom.id,
			parentWorld: parentPose
		});
		const project: Project = {
			id: 'group-project',
			name: 'Group project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: {
				width: 800,
				height: 400,
				fps: 30,
				backgroundColor: '#000000'
			},
			timeline: {
				tracks: [track('top-track', 0), track('bottom-track', 1)],
				items: [bottom, top]
			}
		};
		editorSession.project = project;
		timelineStore.setAll({
			items: [bottom, top],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(PreviewPlayer, {
			selectedItemId: top.id,
			selectedItemIds: [bottom.id, top.id],
			onedit
		});
		screen.container.style.width = '800px';
		screen.container.style.height = '500px';
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-group-transform-box]')).not.toBeNull();
		});
		expect(screen.container.querySelector('[data-on-canvas-tools]')).toBeNull();
		const move = screen.container.querySelector<HTMLButtonElement>('[data-group-transform-box]');
		move?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				shiftKey: true,
				bubbles: true
			})
		);
		expect(timelineStore.itemById.get(bottom.id)?.transform?.x).toBe(-90);
		expect(timelineStore.itemById.get(top.id)?.transform?.x).toBe(100);
		expect(
			resolveAnimatedItemAt(timelineStore.itemById.get(top.id)!, 0, {
				fps: 30,
				frameWidth: 800,
				frameHeight: 400,
				items: timelineStore.items
			}).transform?.x
		).toBe(110);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('GROUP_TRANSFORM');
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get(bottom.id)?.transform?.x).toBe(-100);
		expect(timelineStore.itemById.get(top.id)?.transform?.x).toBe(100);
		const scale = screen.container.querySelector<HTMLButtonElement>(
			'[data-group-scale-handle="0"]'
		);
		scale?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(timelineStore.itemById.get(bottom.id)?.fontSize).toBeCloseTo(60.6);
		expect(timelineStore.itemById.get(top.id)?.fontSize).toBeCloseTo(60.6);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get(bottom.id)?.fontSize).toBeUndefined();
		expect(timelineStore.itemById.get(top.id)?.fontSize).toBeUndefined();
		timelineStore._updateItems([
			{
				id: bottom.id,
				patch: { keyframes: { width: { frames: [0], values: [100] } } }
			},
			{
				id: top.id,
				patch: { keyframes: { width: { frames: [0], values: [100] } } }
			}
		]);
		await vi.waitFor(() =>
			expect(timelineStore.itemById.get(top.id)?.keyframes?.width).toBeDefined()
		);
		scale?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(timelineStore.itemById.get(bottom.id)?.fontSize).toBeUndefined();
		expect(timelineStore.itemById.get(top.id)?.fontSize).toBeUndefined();
		expect(timelineStore.itemById.get(bottom.id)?.keyframes?.fontSize?.values).toEqual([60.6]);
		expect(timelineStore.itemById.get(top.id)?.keyframes?.fontSize?.values).toEqual([60.6]);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get(bottom.id)?.keyframes?.fontSize).toBeUndefined();
		expect(timelineStore.itemById.get(top.id)?.keyframes?.fontSize).toBeUndefined();

		await page.viewport(320, 720);
		screen.container.style.width = '320px';
		screen.container.style.height = '320px';
		await vi.waitFor(() => {
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
				document.documentElement.clientWidth
			);
		});
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-preview-group-transform-320.png'
		});

		timelineStore._setTracks([
			track('top-track', 0),
			{ ...track('bottom-track', 1), locked: true }
		]);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-group-transform-box]')).toBeNull();
		});
	});

	it('nudges the active visual selection through remappable global shortcuts', async () => {
		const bottom = colorLayer('bottom', 'bottom-track', '#ff0000');
		const top = colorLayer('top', 'top-track', '#0000ff');
		bottom.transform = { x: -100, y: 0, width: 100, height: 100 };
		top.transform = { x: 100, y: 0, width: 100, height: 100 };
		const project: Project = {
			id: 'nudge-project',
			name: 'Nudge project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: {
				width: 800,
				height: 400,
				fps: 30,
				backgroundColor: '#000000'
			},
			timeline: {
				tracks: [track('top-track', 0), track('bottom-track', 1)],
				items: [bottom, top]
			}
		};
		editorSession.project = project;
		timelineStore.setAll({
			items: [bottom, top],
			tracks: project.timeline!.tracks,
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(PreviewPlayer, {
			selectedItemId: top.id,
			selectedItemIds: [bottom.id, top.id],
			onedit
		});
		const key = (
			value: string,
			code: string,
			options: Pick<KeyboardEventInit, 'shiftKey' | 'metaKey' | 'altKey'>,
			target: EventTarget = window
		) =>
			target.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: value,
					code,
					bubbles: true,
					cancelable: true,
					...options
				})
			);

		key('ArrowRight', 'ArrowRight', { shiftKey: true });
		expect(timelineStore.itemById.get(bottom.id)?.transform?.x).toBe(-99);
		expect(timelineStore.itemById.get(top.id)?.transform?.x).toBe(101);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		key('ArrowDown', 'ArrowDown', { shiftKey: true, metaKey: true });
		expect(timelineStore.itemById.get(bottom.id)?.transform?.y).toBe(10);
		expect(timelineStore.itemById.get(top.id)?.transform?.y).toBe(10);
		expect(commandHistory.undoStack).toHaveLength(2);

		keyboardShortcuts.setBinding('NUDGE_LEFT', 'alt+9');
		key('ArrowLeft', 'ArrowLeft', { shiftKey: true });
		expect(timelineStore.itemById.get(bottom.id)?.transform?.x).toBe(-99);
		key('9', 'Digit9', { altKey: true });
		expect(timelineStore.itemById.get(bottom.id)?.transform?.x).toBe(-100);

		const input = document.createElement('input');
		screen.container.append(input);
		input.focus();
		key('9', 'Digit9', { altKey: true }, input);
		expect(timelineStore.itemById.get(bottom.id)?.transform?.x).toBe(-100);

		timelineStore._setTracks([
			track('top-track', 0),
			{ ...track('bottom-track', 1), locked: true }
		]);
		key('ArrowDown', 'ArrowDown', { shiftKey: true, metaKey: true });
		expect(timelineStore.itemById.get(bottom.id)?.transform?.y).toBe(10);
		expect(timelineStore.itemById.get(top.id)?.transform?.y).toBe(10);

		timelineStore._setTracks([track('top-track', 0), track('bottom-track', 1)]);
		timelineStore._setCurrentFrame(30);
		key('ArrowDown', 'ArrowDown', { shiftKey: true, metaKey: true });
		expect(timelineStore.itemById.get(bottom.id)?.transform?.y).toBe(10);
		expect(timelineStore.itemById.get(top.id)?.transform?.y).toBe(10);

		timelineStore._setCurrentFrame(0);
		const pendingPick = colorPreviewStore.requestPick(top.id, 'white-balance');
		key('ArrowDown', 'ArrowDown', { shiftKey: true, metaKey: true });
		expect(timelineStore.itemById.get(bottom.id)?.transform?.y).toBe(10);
		expect(timelineStore.itemById.get(top.id)?.transform?.y).toBe(10);
		colorPreviewStore.cancelPick();
		expect(await pendingPick).toBeNull();
	});

	it('runs the spatial point editor as the program monitor exclusive tool', async () => {
		await page.viewport(1000, 700);
		const layer: TimelineItem = {
			...colorLayer('spatial', 'video-track', '#808080'),
			effects: [
				{
					id: 'twirl',
					type: 'gpu',
					effectId: 'gpu-twirl',
					enabled: true,
					params: { amount: 1, radius: 0.5, centerX: 0.25, centerY: 0.75 }
				}
			]
		};
		const project: Project = {
			id: 'spatial-project',
			name: 'Spatial project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: { width: 4, height: 4, fps: 30, backgroundColor: '#000000' },
			timeline: { tracks: [track('video-track', 0)], items: [layer] }
		};
		editorSession.project = project;
		timelineStore.setAll({
			items: [layer],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		spatialEffectEditorStore.startEditing(layer.id, 'twirl');
		const onedit = vi.fn();
		const screen = await render(PreviewPlayer, {
			selectedItemId: layer.id,
			onedit
		});
		screen.container.style.width = '800px';
		screen.container.style.height = '500px';
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-spatial-effect-overlay]')).not.toBeNull();
		});
		const handle = screen.container.querySelector<HTMLButtonElement>(
			'[data-spatial-effect-handle="twirl"]'
		);
		expect(handle?.style.left).toBe('25%');
		expect(handle?.style.top).toBe('75%');
		expect(screen.container.querySelector('[data-on-canvas-tools]')).toBeNull();
		expect(onedit).not.toHaveBeenCalled();
		const monitor = screen.container.querySelector<HTMLElement>('[data-program-monitor]');
		expect(monitor).not.toBeNull();
		await page.viewport(320, 720);
		screen.container.style.width = '320px';
		screen.container.style.height = '320px';
		await vi.waitFor(() => {
			expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
				document.documentElement.clientWidth
			);
		});

		spatialEffectEditorStore.stopEditing();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-spatial-effect-overlay]')).toBeNull();
			expect(screen.container.querySelector('[data-on-canvas-tools]')).not.toBeNull();
		});

		spatialEffectEditorStore.startEditing(layer.id, 'twirl');
		timelineStore._setTracks([{ ...track('video-track', 0), locked: true }]);
		await vi.waitFor(() => expect(spatialEffectEditorStore.isEditing).toBe(false));
		expect(screen.container.querySelector('[data-spatial-effect-overlay]')).toBeNull();
	});

	it('renders the hover-preview frame while leaving the committed frame unchanged', async () => {
		const layer = {
			...colorLayer('hover-only', 'video-track', '#ff0000'),
			from: 30,
			durationInFrames: 30
		};
		const project: Project = {
			id: 'hover-preview-project',
			name: 'Hover preview project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 2,
			metadata: { width: 4, height: 4, fps: 30, backgroundColor: '#000000' },
			timeline: { tracks: [track('video-track', 0)], items: [layer] }
		};
		editorSession.project = project;
		timelineStore.setAll({
			items: [layer],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, { onedit: vi.fn() });
		expect(screen.container.querySelector('[data-preview-item="hover-only"]')).toBeNull();

		timelinePreviewScrub.setFrame(30);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-preview-item="hover-only"]')).not.toBeNull();
		});
		expect(timelineStore.currentFrame).toBe(0);

		timelinePreviewScrub.clear();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-preview-item="hover-only"]')).toBeNull();
		});
	});

	it('shows opt-in live and clip timing overlays without project or media names', async () => {
		const project = diagnosticVideoProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		previewDiagnostics.setPerformanceOverlay(true);
		previewDiagnostics.setClipTimingOverlay(true);
		const screen = await render(PreviewPlayer, {
			selectedItemId: 'clip-12345678',
			onedit: vi.fn()
		});

		await expect.element(screen.getByTestId('preview-performance-diagnostics')).toBeVisible();
		const clipOverlay = screen.getByTestId('preview-clip-diagnostics');
		await expect.element(clipOverlay).toBeVisible();
		await expect.element(screen.getByText(/clip-123 · 0-30f/)).toBeVisible();
		expect(clipOverlay.element().textContent).toContain('Source 5-35f');
		expect(clipOverlay.element().textContent).toContain('1.50x');
		expect(screen.container.textContent).not.toContain('Private clip name');
		expect(screen.container.textContent).not.toContain('Private project name');
		expect(screen.container.textContent).not.toContain('private-media-id');
	});

	it('reduces real stacked preview pixels when Auto quality adapts down', async () => {
		const project = maskedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		previewPlaybackSettings.setPreviewQuality('auto');
		adaptivePreviewQuality.__setScaleForTesting(0.5);
		const screen = await render(PreviewPlayer, {
			selectedItemId: 'mask',
			onedit: vi.fn()
		});
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;
		await vi.waitFor(() => {
			expect(preview.width).toBe(4);
			expect(preview.height).toBe(4);
		});
		previewPlaybackSettings.setPreviewQuality('full');
		await vi.waitFor(() => {
			expect(preview.width).toBe(8);
			expect(preview.height).toBe(8);
		});
	});

	it('matches export pixels for a projective corner pin', async () => {
		const project = cornerPinnedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, {
			selectedItemId: 'content',
			onedit: vi.fn()
		});
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;
		await vi.waitFor(() => {
			const context = preview.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('2D canvas unavailable');
			expect([...context.getImageData(0, 4, 1, 1).data]).toEqual([0, 0, 255, 255]);
			expect([...context.getImageData(4, 4, 1, 1).data]).toEqual([255, 0, 0, 255]);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const context = exported.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('2D canvas unavailable');
			expect([...context.getImageData(0, 4, 1, 1).data]).toEqual([0, 0, 255, 255]);
			expect([...context.getImageData(4, 4, 1, 1).data]).toEqual([255, 0, 0, 255]);
		} finally {
			renderer.dispose();
		}
	});

	it('matches export pixels for a track-scoped shape mask', async () => {
		const project = maskedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, {
			selectedItemId: 'mask',
			onedit: vi.fn()
		});
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;

		await vi.waitFor(() => {
			const context = preview.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			const center = [...context.getImageData(4, 4, 1, 1).data];
			const outside = [...context.getImageData(0, 0, 1, 1).data];
			expect(center).toEqual([255, 0, 0, 255]);
			expect(outside).toEqual([0, 0, 255, 255]);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const context = exported.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('2D canvas unavailable');
			expect([...context.getImageData(4, 4, 1, 1).data]).toEqual([255, 0, 0, 255]);
			expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255]);
		} finally {
			renderer.dispose();
		}
	});

	it('matches export pixels when a top layer multiplies the finished layer below', async () => {
		const project = blendProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		expect(timelineStore.tracks).toHaveLength(2);
		const screen = await render(PreviewPlayer, { onedit: vi.fn() });
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;

		await vi.waitFor(() => {
			const [red, green, blue, alpha] = centerPixel(preview);
			expect(red).toBeGreaterThanOrEqual(62);
			expect(red).toBeLessThanOrEqual(66);
			expect(green).toBe(red);
			expect(blue).toBe(red);
			expect(alpha).toBe(255);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const [red, green, blue, alpha] = centerPixel(exported);
			expect(red).toBeGreaterThanOrEqual(62);
			expect(red).toBeLessThanOrEqual(66);
			expect(green).toBe(red);
			expect(blue).toBe(red);
			expect(alpha).toBe(255);
		} finally {
			renderer.dispose();
		}
	});

	it('renders a split before surface without changing the graded export', async () => {
		const project = gradedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		colorPreviewStore.setComparisonMode('split');
		const screen = await render(PreviewPlayer, {
			selectedItemId: 'graded',
			onedit: vi.fn()
		});
		const after = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		const before = screen.container.querySelector<HTMLCanvasElement>('[data-color-before-preview]');
		expect(after).not.toBeNull();
		expect(before).not.toBeNull();
		if (!after || !before) return;

		await vi.waitFor(() => {
			const [afterRed] = centerPixel(after);
			const [beforeRed] = centerPixel(before);
			expect(afterRed).toBeGreaterThanOrEqual(190);
			expect(afterRed).toBeLessThanOrEqual(194);
			expect(beforeRed).toBeGreaterThanOrEqual(126);
			expect(beforeRed).toBeLessThanOrEqual(130);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const [red] = centerPixel(exported);
			expect(red).toBeGreaterThanOrEqual(190);
			expect(red).toBeLessThanOrEqual(194);
		} finally {
			renderer.dispose();
		}
	});

	it('samples the visible preview with a keyboard-cancellable loupe picker', async () => {
		const project = gradedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, {
			selectedItemId: 'graded',
			onedit: vi.fn()
		});
		const picked = colorPreviewStore.requestPick('graded', 'white-balance');
		await vi.waitFor(() => {
			expect(
				screen.container.querySelector<HTMLButtonElement>(
					'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
				)
			).not.toBeNull();
		});
		const overlay = screen.container.querySelector<HTMLButtonElement>(
			'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
		);
		if (!overlay) throw new Error('picker overlay missing');
		scopeSamples.publish('graded', new ImageData(new Uint8ClampedArray([51, 102, 153, 255]), 1, 1));
		const rect = overlay.getBoundingClientRect();
		const pointer = {
			bubbles: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2
		};
		overlay.dispatchEvent(new PointerEvent('pointermove', pointer));
		await expect.element(screen.getByText('#336699', { exact: true })).toBeVisible();
		overlay.dispatchEvent(new PointerEvent('pointerdown', pointer));
		expect(await picked).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
		expect(colorPreviewStore.activePicker).toBeNull();

		const cancelled = colorPreviewStore.requestPick('graded', 'black-point');
		await vi.waitFor(() => {
			expect(
				screen.container.querySelector<HTMLButtonElement>(
					'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
				)
			).not.toBeNull();
		});
		screen.container
			.querySelector<HTMLButtonElement>(
				'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
			)
			?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(await cancelled).toBeNull();
		expect(colorPreviewStore.activePicker).toBeNull();
	});

	it('captures the finished preview frame for auto balance without touching export state', async () => {
		const project = gradedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		await render(PreviewPlayer, { selectedItemId: 'graded', onedit: vi.fn() });
		const image = await colorPreviewStore.requestFrameCapture('graded');
		expect(image).not.toBeNull();
		if (!image) return;
		const center = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
		expect(image.data[center]).toBeGreaterThanOrEqual(190);
		expect(image.data[center]).toBeLessThanOrEqual(194);
		expect(colorPreviewStore.frameCaptureItemId).toBeNull();
	});
});
