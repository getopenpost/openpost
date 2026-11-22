import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { z } from 'zod';
import { m } from '$lib/paraglide/messages';
import type { TimelineItem } from '../project/types';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { DEFAULT_PATTERN_BACKGROUND } from '../backgrounds/types';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { resolveAnimatedItemLocalAt } from '../timeline/animated-properties';
import { transitionRegistry } from '../transitions';
import {
	addTransition,
	transitionsStore,
	updateTransition
} from '../timeline/actions/transitions.svelte';
import { gradientMap } from '../effects/gpu/shaders/color';
import BackgroundPropertiesPanel from './background-properties-panel.svelte';
import EffectBrowserPanel from './effect-browser-panel.svelte';
import GpuGradientMapPanel from './gpu-gradient-map-panel.svelte';
import LottieBrowserPanel from './lottie-browser-panel.svelte';
import ProjectCanvasPanel from './project-canvas-panel.svelte';
import ShapePropertiesPanel from './shape-properties-panel.svelte';
import TextPropertiesPanel from './text-properties-panel.svelte';
import TransitionPropertiesPanel from './transition-properties-panel.svelte';
import '../../../routes/layout.css';

afterEach(() => {
	editorSession.project = null;
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	transitionsStore.clear();
	commandHistory.clearHistory();
});

describe('BackgroundPropertiesPanel', () => {
	it('shows and edits an existing background rotation key without requiring auto-key', async () => {
		const item: TimelineItem = {
			id: 'background',
			trackId: 'visual',
			from: 0,
			durationInFrames: 90,
			type: 'background',
			label: 'Pattern',
			background: { ...DEFAULT_PATTERN_BACKGROUND },
			keyframes: { backgroundRotation: { frames: [0, 60], values: [0, 60] } }
		};
		timelineStore._setItems([item]);
		timelineStore._setCurrentFrame(30);
		const screen = await render(BackgroundPropertiesPanel, { item, onedit: vi.fn() });
		const rotation = screen.getByRole('slider', {
			name: m.video_editor_background_rotation(),
			exact: true
		});
		await expect.element(rotation).toHaveAttribute('aria-valuenow', '30');
		const rotationElement = rotation.element();
		if (!(rotationElement instanceof HTMLElement)) {
			throw new Error('Expected HTMLElement slider');
		}
		rotationElement.focus();
		await userEvent.keyboard('{ArrowRight}');
		const value = Number(rotation.element().getAttribute('aria-valuenow'));
		expect(value).not.toBe(30);
		expect(
			resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 30).background?.rotation
		).toBe(value);
		expect(
			resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 0).background?.rotation
		).toBe(0);
	});

	it('keeps an unanimated background unchanged when its track is locked', async () => {
		const item: TimelineItem = {
			id: 'locked',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 90,
			type: 'background',
			label: 'Pattern',
			background: { ...DEFAULT_PATTERN_BACKGROUND }
		};
		timelineStore._setTracks(createDefaultTracks().map((track) => ({ ...track, locked: true })));
		timelineStore._setItems([item]);
		const screen = await render(BackgroundPropertiesPanel, { item, onedit: vi.fn() });
		const rotation = screen.getByRole('slider', {
			name: m.video_editor_background_rotation(),
			exact: true
		});
		const rotationElement = rotation.element();
		if (!(rotationElement instanceof HTMLElement)) {
			throw new Error('Expected HTMLElement slider');
		}
		rotationElement.focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(timelineStore.itemById.get(item.id)?.background?.rotation).toBe(0);
		expect(commandHistory.canUndo).toBe(false);
	});
});

describe('EffectBrowserPanel', () => {
	it('treats a double click as one effect insertion', async () => {
		timelineStore._setTracks(createDefaultTracks());
		timelineStore._setItems([
			{
				id: 'circle',
				label: 'circle',
				type: 'shape',
				shapeType: 'ellipse',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 60
			}
		]);
		const onedit = vi.fn();
		const screen = await render(EffectBrowserPanel, {
			selectedItemIds: ['circle'],
			oninserted: vi.fn(),
			onedit
		});
		await userEvent.dblClick(screen.getByRole('button', { name: 'Invert', exact: true }));
		expect(timelineStore.items[0]?.effects).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();
	});
});

describe('GpuGradientMapPanel', () => {
	it.each([256, 144])('keeps every custom stop number visible in a %spx panel', async (width) => {
		const host = document.createElement('div');
		host.style.width = `${width}px`;
		document.body.append(host);
		try {
			const screen = await render(GpuGradientMapPanel, {
				target: host,
				props: {
					effectLabel: 'Gradient Map',
					definition: gradientMap,
					values: {
						preset: 'custom',
						customStops: '#000000,#ff0000,#00ff00,#0000ff,#888888,#ffffff',
						mix: 1
					},
					oncommit: vi.fn(),
					ondraft: vi.fn(),
					keyframe: () => undefined
				}
			});
			await document.fonts.ready;
			for (let number = 1; number <= 6; number++) {
				const label = screen.getByText(new RegExp(`^Custom Stops\\s*${number}$`)).element();
				const text = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
				let numberNode: Node | null = null;
				while (text.nextNode()) {
					if (
						text.currentNode.textContent?.trim() === `${number}` ||
						text.currentNode.textContent?.trim().endsWith(`${number}`)
					) {
						numberNode = text.currentNode;
					}
				}
				expect(numberNode).not.toBeNull();
				const offset = numberNode!.textContent!.lastIndexOf(`${number}`);
				const range = document.createRange();
				range.setStart(numberNode!, offset);
				range.setEnd(numberNode!, offset + `${number}`.length);
				const glyph = range.getBoundingClientRect();
				const bounds = label.getBoundingClientRect();
				expect(glyph.left).toBeGreaterThanOrEqual(bounds.left);
				expect(glyph.right).toBeLessThanOrEqual(bounds.right);
				expect(bounds.right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
			}
		} finally {
			host.remove();
		}
	});
});

describe('LottieBrowserPanel', () => {
	it('offers an honest retry after service unavailability without importing an animation', async () => {
		const fetchAnimations = vi
			.fn()
			.mockRejectedValueOnce(new Error('LottieFiles request failed (503).'))
			.mockResolvedValueOnce({
				items: [
					{
						id: 'recovered',
						name: 'Recovered animation',
						lottieUrl: 'https://example.com/animation.json',
						gifUrl: null,
						bgColor: null,
						author: 'Fixture creator',
						authorPath: null
					}
				],
				endCursor: null,
				hasNextPage: false,
				totalCount: 1
			});
		const importAnimation = vi.fn();
		const screen = await render(LottieBrowserPanel, {
			projectId: 'recovery',
			fetchAnimations,
			importAnimation
		});
		try {
			await expect
				.element(screen.getByText('LottieFiles request failed (503).', { exact: true }))
				.toBeVisible();
			await screen
				.getByRole('button', { name: m.video_editor_lottiefiles_retry(), exact: true })
				.click();
			await expect
				.element(
					screen.getByRole('button', {
						name: `${m.video_editor_lottiefiles_add()}: Recovered animation`,
						exact: true
					})
				)
				.toBeVisible();
			await expect
				.element(screen.getByText('LottieFiles request failed (503).', { exact: true }))
				.not.toBeInTheDocument();
			expect(fetchAnimations).toHaveBeenCalledTimes(2);
			expect(importAnimation).not.toHaveBeenCalled();
		} finally {
			await screen.unmount();
		}
	});
});

describe('ProjectCanvasPanel', () => {
	it('applies a canvas format in one undo step without changing frame rate or existing layers', async () => {
		const project = createBlankProject('Format test', { width: 1920, height: 1080, fps: 24 });
		if (!project.timeline) throw new Error('Expected a blank timeline');
		project.timeline.items = [
			{
				id: 'title',
				type: 'text',
				label: 'Title',
				text: 'Launch',
				trackId: 'track-video-main',
				from: 30,
				durationInFrames: 120,
				transform: { x: 80, y: 20, width: 600, height: 200 }
			}
		];
		const originalItems = structuredClone(project.timeline.items);
		editorSession.project = project;
		sequenceStore.load(project.timeline, project.metadata);
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(ProjectCanvasPanel, { onedit });
		await screen.getByRole('button', { name: 'Dimensions' }).click();
		await screen
			.getByRole('option', { name: 'Shorts, TikTok and Reels · 1080 × 1920', exact: true })
			.click();
		expect(sequenceStore.rootResolution).toMatchObject({ width: 1080, height: 1920, fps: 24 });
		expect(timelineStore.items).toEqual(originalItems);
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(sequenceStore.rootResolution).toMatchObject({ width: 1920, height: 1080, fps: 24 });
		expect(commandHistory.canUndo).toBe(false);
		await expect
			.element(screen.getByRole('spinbutton', { name: 'Width', exact: true }))
			.toHaveValue(1920);
	});
});

describe('ShapePropertiesPanel', () => {
	it('edits a keyed stroke width at the playhead', async () => {
		const item: TimelineItem = {
			id: 'shape-1',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 90,
			label: 'Mask shape',
			type: 'shape',
			shapeType: 'rectangle',
			isMask: false,
			strokeEnabled: true,
			strokeWidth: 8,
			keyframes: { strokeWidth: { frames: [0, 60], values: [8, 24] } }
		};
		timelineStore._setItems([item]);
		timelineStore._setCurrentFrame(30);
		commandHistory.clearHistory();
		const screen = await render(ShapePropertiesPanel, { item, onedit: vi.fn() });
		const width = screen.getByRole('spinbutton', {
			name: m.video_editor_shape_stroke_width(),
			exact: true
		});
		await expect.element(width).toHaveValue(16);
		await width.fill('20');
		await userEvent.tab();
		expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 30).strokeWidth).toBe(
			20
		);
		expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 0).strokeWidth).toBe(8);
		commandHistory.undo();
		await expect.element(width).toHaveValue(16);
	});
});

describe('TextPropertiesPanel', () => {
	it('shows and edits animated font size at the playhead without changing the starting size', async () => {
		const item: TimelineItem = {
			id: 'text-1',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 90,
			label: 'Launch title',
			type: 'text',
			text: 'Ship the work',
			fontFamily: 'Inter',
			fontSize: 64,
			fontWeight: 700,
			color: '#ffffff',
			keyframes: { fontSize: { frames: [0, 60], values: [64, 128] } }
		};
		timelineStore._setItems([item]);
		timelineStore._setCurrentFrame(30);
		commandHistory.clearHistory();
		const screen = await render(TextPropertiesPanel, { item, onedit: vi.fn() });
		const size = screen.getByRole('spinbutton', { name: 'Size', exact: true });
		await expect.element(size).toHaveValue(96);
		await size.fill('120');
		await userEvent.tab();
		expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 30).fontSize).toBe(120);
		expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get(item.id)!, 0).fontSize).toBe(64);
		commandHistory.undo();
		await expect.element(size).toHaveValue(96);
	});
});

describe('TransitionPropertiesPanel', () => {
	it('resets changed transition parameters through the panel', async () => {
		const clip = (id: string, from: number): TimelineItem => ({
			id,
			trackId: 'track-video-main',
			from,
			durationInFrames: 60,
			label: id,
			type: 'video',
			mediaId: 'media-1',
			sourceStart: 30,
			sourceEnd: 90,
			sourceDuration: 120,
			sourceFps: 30
		});
		timelineStore._setItems([clip('left', 0), clip('right', 60)]);
		const id = addTransition('left', 'right', 'crossfade', 15, {
			presentation: 'blurDissolve'
		});
		const definition = transitionRegistry.getDefinition('blurDissolve');
		const parameter = definition?.parameters?.[0];
		if (!parameter) {
			throw new Error('Expected a numeric blur transition parameter');
		}
		const defaultValue = z.number().parse(parameter.defaultValue);
		const changedValue = defaultValue + 0.1;
		expect(updateTransition(id, { properties: { [parameter.key]: changedValue } })).toBe(true);

		const screen = await render(TransitionPropertiesPanel, { transitionId: id, onedit: () => {} });
		await screen.getByRole('button', { name: 'Reset effect controls' }).click();
		expect(transitionsStore.list[0]?.properties?.[parameter.key]).toBe(defaultValue);
	});
});
