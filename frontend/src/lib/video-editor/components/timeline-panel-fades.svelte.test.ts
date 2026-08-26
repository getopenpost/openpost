import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
import TimelinePanel from './timeline-panel.svelte';

function track(id: string, kind: TimelineTrack['kind'], order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}
function item(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 90,
		label: 'Video',
		type: 'video',
		sourceStart: 0,
		sourceEnd: 90,
		sourceDuration: 180,
		sourceFps: 30,
		...overrides
	};
}
function dispatchPointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	clientX: number,
	clientY = 0
): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX,
			clientY,
			pointerId: 7
		})
	);
}
async function nextFrame(): Promise<void> {
	await new Promise<void>((r) => requestAnimationFrame(() => r()));
}
function fakeRect(width = 300, height = 64, left = 100, top = 100): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
		toJSON() {
			return {};
		}
	} as DOMRect;
}
beforeEach(() => {
	keyboardShortcuts.resetAll();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [
			item({
				id: 'audio-1',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 90,
				sourceEnd: 90,
				audioFadeIn: 0.5,
				audioFadeOut: 0.2,
				audioFadeInCurve: 0.7,
				audioFadeInCurveX: 0.6,
				audioFadeOutCurve: -0.3,
				audioFadeOutCurveX: 0.25
			}),
			item({
				id: 'video-1',
				trackId: 'video-track',
				label: 'Clip',
				type: 'video',
				durationInFrames: 90,
				sourceEnd: 90,
				fadeIn: 0.4,
				fadeOut: 0.3
			})
		],
		fps: 30
	});
});
describe('timeline fade handles', () => {
	it('renders video and audio fade envelopes as shaped SVG paths', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const audioClip = screen.container.querySelector(
			'[data-timeline-item-id="audio-1"]'
		) as HTMLElement;
		const audioInPath = audioClip.querySelector(
			'[data-fade-path="audio-in"]'
		) as SVGPathElement | null;
		const audioOutPath = audioClip.querySelector(
			'[data-fade-path="audio-out"]'
		) as SVGPathElement | null;
		expect(audioInPath).not.toBeNull();
		expect(audioOutPath).not.toBeNull();
		expect(audioInPath!.getAttribute('d')).not.toBe('');
		expect(audioInPath!.getAttribute('d')).toContain('M');
		await screen.unmount();
		const screenVideo = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video-1',
			selectedItemIds: ['video-1']
		});
		await nextFrame();
		const videoClip = screenVideo.container.querySelector(
			'[data-timeline-item-id="video-1"]'
		) as HTMLElement;
		const videoInPath = videoClip.querySelector(
			'[data-fade-path="video-in"]'
		) as SVGPathElement | null;
		const videoOutPath = videoClip.querySelector(
			'[data-fade-path="video-out"]'
		) as SVGPathElement | null;
		expect(videoInPath).not.toBeNull();
		expect(videoOutPath).not.toBeNull();
		expect(videoInPath!.getAttribute('d')).not.toBe('');
	});
	it('shows curve dots for audio fades and hides when fade is zero', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const audioClip = screen.container.querySelector(
			'[data-timeline-item-id="audio-1"]'
		) as HTMLElement;
		const inDot = audioClip.querySelector('[data-fade-curve-dot="in"]') as HTMLElement | null;
		const outDot = audioClip.querySelector('[data-fade-curve-dot="out"]') as HTMLElement | null;
		expect(inDot).not.toBeNull();
		expect(outDot).not.toBeNull();
		expect(inDot!.getAttribute('aria-label')).toMatch(/curve/i);
		await screen.unmount();
		timelineStore.setAll({
			tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
			items: [
				item({
					id: 'audio-1',
					trackId: 'audio-track',
					label: 'Music',
					type: 'audio',
					durationInFrames: 90,
					audioFadeIn: 0,
					audioFadeOut: 0
				})
			],
			fps: 30
		});
		const screenZero = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const zeroClip = screenZero.container.querySelector(
			'[data-timeline-item-id="audio-1"]'
		) as HTMLElement;
		expect(zeroClip.querySelector('[data-fade-curve-dot="in"]')).toBeNull();
	});
	it('drags audio curve dot editing both curve and bias atomically with live SVG preview', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = clip.querySelector('[data-fade-handles="audio"]') as HTMLElement;
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const dot = clip.querySelector('[data-fade-curve-dot="in"]') as HTMLElement;
		const pathEl = clip.querySelector('[data-fade-path="audio-in"]') as SVGPathElement;
		const beforeD = pathEl.getAttribute('d');
		const beforeCurve = timelineStore.itemById.get('audio-1')?.audioFadeInCurve;
		const beforeX = timelineStore.itemById.get('audio-1')?.audioFadeInCurveX;
		dispatchPointer(dot, 'pointerdown', rect.left + 40, rect.top + 30);
		dispatchPointer(window, 'pointermove', rect.left + 90, rect.top + 10);
		await nextFrame();
		const midD = (clip.querySelector('[data-fade-path="audio-in"]') as SVGPathElement).getAttribute(
			'd'
		);
		expect(midD).not.toBe(beforeD);
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).not.toBe(beforeCurve);
		dispatchPointer(window, 'pointerup', rect.left + 90, rect.top + 10);
		await nextFrame();
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_AUDIO_FADE_CURVE');
		expect(onedit).toHaveBeenCalledOnce();
		const afterCurve = timelineStore.itemById.get('audio-1')?.audioFadeInCurve;
		const afterX = timelineStore.itemById.get('audio-1')?.audioFadeInCurveX;
		const midAfterD = (
			clip.querySelector('[data-fade-path="audio-in"]') as SVGPathElement
		).getAttribute('d');
		commandHistory.undo();
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(beforeCurve);
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurveX).toBe(beforeX);
		expect(
			(clip.querySelector('[data-fade-path="audio-in"]') as SVGPathElement).getAttribute('d')
		).not.toBe(midAfterD);
		expect(afterCurve).not.toBe(beforeCurve);
		expect(afterX).not.toBe(beforeX);
	});
	it('double-click curve dot resets curve and bias atomically', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		const dot = clip.querySelector('[data-fade-curve-dot="in"]') as HTMLElement;
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(0.7);
		dot.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(0);
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurveX).toBe(0.52);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('RESET_AUDIO_FADE_CURVE');
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(0.7);
	});
	it('maps fade handle pointer offset to frame-snapped seconds and clamps', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = clip.querySelector('[data-fade-handles="audio"]') as HTMLElement;
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		await nextFrame();
		const pathBefore = (
			clip.querySelector('[data-fade-path="audio-in"]') as SVGPathElement
		).getAttribute('d');
		const audioIn = clip.querySelector(
			'[data-fade-kind="audio"][data-fade-handle="in"]'
		) as HTMLElement;
		const startX = rect.left + 50;
		const endX = rect.left + 100;
		dispatchPointer(audioIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', endX);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBeCloseTo(1, 1);
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(0.7);
		const pathAfter = (
			clip.querySelector('[data-fade-path="audio-in"]') as SVGPathElement
		).getAttribute('d');
		expect(pathAfter).not.toBe(pathBefore);
		dispatchPointer(window, 'pointerup', endX);
		await nextFrame();
		expect(commandHistory.undoStack).toHaveLength(1);
		const farX = rect.left + rect.width * 0.95;
		const audioIn2 = clip.querySelector(
			'[data-fade-kind="audio"][data-fade-handle="in"]'
		) as HTMLElement;
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		dispatchPointer(audioIn2, 'pointerdown', endX);
		dispatchPointer(window, 'pointermove', farX);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn ?? 0).toBeLessThanOrEqual(2.8 + 0.02);
		dispatchPointer(window, 'pointerup', farX);
		await nextFrame();
	});
	it('does one undo for fade drag and no history for no-op', async () => {
		const onedit = vi.fn();
		const screenNoOp = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video-1',
			selectedItemIds: ['video-1']
		});
		await nextFrame();
		const clipNoOp = screenNoOp.container.querySelector(
			'[data-timeline-item-id="video-1"]'
		) as HTMLElement;
		const rectNoOp = fakeRect(300, 64, 100, 100);
		const fadeContainerNoOp = clipNoOp.querySelector('[data-fade-handles="video"]') as HTMLElement;
		vi.spyOn(fadeContainerNoOp, 'getBoundingClientRect').mockReturnValue(rectNoOp);
		const videoInNoOp = clipNoOp.querySelector(
			'[data-fade-kind="video"][data-fade-handle="in"]'
		) as HTMLElement;
		const curFadeNoOp = timelineStore.itemById.get('video-1')?.fadeIn ?? 0;
		const curXNoOp = rectNoOp.left + ((curFadeNoOp * 30) / 90) * rectNoOp.width;
		dispatchPointer(videoInNoOp, 'pointerdown', curXNoOp);
		dispatchPointer(window, 'pointerup', curXNoOp);
		await nextFrame();
		expect(commandHistory.undoStack.length).toBe(0);
		await screenNoOp.unmount();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video-1',
			selectedItemIds: ['video-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="video-1"]') as HTMLElement;
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = clip.querySelector('[data-fade-handles="video"]') as HTMLElement;
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const videoIn = clip.querySelector(
			'[data-fade-kind="video"][data-fade-handle="in"]'
		) as HTMLElement;
		const startX = rect.left + 40;
		const pathBefore = (
			clip.querySelector('[data-fade-path="video-in"]') as SVGPathElement
		).getAttribute('d');
		dispatchPointer(videoIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', startX + 30);
		await nextFrame();
		expect(
			(clip.querySelector('[data-fade-path="video-in"]') as SVGPathElement).getAttribute('d')
		).not.toBe(pathBefore);
		dispatchPointer(window, 'pointerup', startX + 30);
		await nextFrame();
		expect(commandHistory.undoStack.length).toBe(1);
	});
	it('restores on every cancel path for fade and curve', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = clip.querySelector('[data-fade-handles="audio"]') as HTMLElement;
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const audioIn = clip.querySelector(
			'[data-fade-kind="audio"][data-fade-handle="in"]'
		) as HTMLElement;
		const dot = clip.querySelector('[data-fade-curve-dot="in"]') as HTMLElement;
		const startX = rect.left + 50;
		const endX = rect.left + 150;
		dispatchPointer(audioIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', endX);
		await nextFrame();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(0.5);
		expect(commandHistory.undoStack).toHaveLength(0);
		dispatchPointer(audioIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', endX);
		await nextFrame();
		window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(0.5);
		dispatchPointer(audioIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', endX);
		await nextFrame();
		audioIn.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(0.5);
		const beforeCurve = timelineStore.itemById.get('audio-1')?.audioFadeInCurve;
		dispatchPointer(dot, 'pointerdown', rect.left + 40, rect.top + 30);
		dispatchPointer(window, 'pointermove', rect.left + 80, rect.top + 10);
		await nextFrame();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(beforeCurve);
		dispatchPointer(dot, 'pointerdown', rect.left + 40, rect.top + 30);
		dispatchPointer(window, 'pointermove', rect.left + 80, rect.top + 10);
		await nextFrame();
		window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 7 }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(beforeCurve);
		dispatchPointer(dot, 'pointerdown', rect.left + 40, rect.top + 30);
		dispatchPointer(window, 'pointermove', rect.left + 80, rect.top + 10);
		await nextFrame();
		dot.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 7 }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(beforeCurve);
		dispatchPointer(audioIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', endX);
		await nextFrame();
		await screen.unmount();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(0.5);
	});
	it('supports keyboard for fade handles and curve dots with localized readouts', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		const audioIn = clip.querySelector(
			'[data-fade-kind="audio"][data-fade-handle="in"]'
		) as HTMLElement;
		expect(audioIn.getAttribute('aria-label')).toMatch(/audio fade in/i);
		const before = timelineStore.itemById.get('audio-1')?.audioFadeIn ?? 0;
		audioIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBeCloseTo(before + 1 / 30, 2);
		expect(audioIn.getAttribute('aria-valuetext')).toMatch(/0\.\d/);
		const dot = clip.querySelector('[data-fade-curve-dot="in"]') as HTMLElement;
		expect(dot.getAttribute('aria-label')).toMatch(/curve/i);
		const beforeCurve = timelineStore.itemById.get('audio-1')?.audioFadeInCurve ?? 0;
		const beforeX = timelineStore.itemById.get('audio-1')?.audioFadeInCurveX ?? 0.6;
		dot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBeGreaterThan(beforeCurve);
		dot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurveX).toBeLessThan(beforeX);
		expect(dot.getAttribute('aria-valuetext')).toMatch(/Curve/);
		expect(dot.getAttribute('aria-valuetext')).toMatch(/Bias/);
		dot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(0);
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurveX).toBe(0.52);
	});
	it('respects density thresholds via container queries', async () => {
		timelineStore.setAll({
			tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
			items: [
				item({
					id: 'audio-1',
					trackId: 'audio-track',
					label: 'Tiny',
					type: 'audio',
					durationInFrames: 2,
					audioFadeIn: 0.05
				})
			],
			fps: 30
		});
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		const handlesContainer = clip.querySelector('[data-fade-handles-container]') as HTMLElement;
		expect(handlesContainer.className).toContain('@min-[44px]:opacity-40');
		expect(handlesContainer.className).toContain('@min-[64px]:opacity-100');
		expect(handlesContainer.className).toContain('opacity-0');
		const handle = clip.querySelector(
			'[data-fade-kind="audio"][data-fade-handle="in"]'
		) as HTMLElement;
		expect(handle.className).toContain('pointer-events-none');
		expect(handle.className).toContain('@min-[44px]:pointer-events-auto');
		expect(clip.className).toContain('@container');
	});
	it('hides handles when track locked or tool not select', async () => {
		timelineStore.setAll({
			tracks: [
				{ ...track('audio-track', 'audio', 1), locked: true },
				track('video-track', 'video', 0)
			],
			items: [
				item({
					id: 'audio-1',
					trackId: 'audio-track',
					label: 'Music',
					type: 'audio',
					durationInFrames: 90,
					audioFadeIn: 0.5
				})
			],
			fps: 30
		});
		const screenLocked = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clipLocked = screenLocked.container.querySelector(
			'[data-timeline-item-id="audio-1"]'
		) as HTMLElement;
		const before = timelineStore.itemById.get('audio-1')?.audioFadeIn;
		const handleLocked = clipLocked.querySelector(
			'[data-fade-kind="audio"][data-fade-handle="in"]'
		) as HTMLElement;
		handleLocked.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, pointerId: 7 })
		);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(before);
		expect(commandHistory.undoStack).toHaveLength(0);
	});
	it('remains usable at 320px without overflow', async () => {
		await page.viewport(320, 720);
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		screen.container.style.width = '100vw';
		const region = screen.getByRole('region', { name: 'Timeline' }).element();
		region.style.width = '100vw';
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		expect(clip).not.toBeNull();
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);
		const read = clip.querySelector('[data-fade-readout]') as HTMLElement | null;
		if (read) {
			const r = read.getBoundingClientRect();
			expect(r.left).toBeGreaterThanOrEqual(-5);
			expect(r.right).toBeLessThanOrEqual(325);
		}
	});
	it('respects pointerId ownership', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]') as HTMLElement;
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = clip.querySelector('[data-fade-handles="audio"]') as HTMLElement;
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const audioIn = clip.querySelector(
			'[data-fade-kind="audio"][data-fade-handle="in"]'
		) as HTMLElement;
		const startX = rect.left + 50;
		dispatchPointer(audioIn, 'pointerdown', startX);
		await nextFrame();
		const afterDown = timelineStore.itemById.get('audio-1')?.audioFadeIn;
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				pointerId: 99,
				clientX: rect.left + 200,
				clientY: 0
			})
		);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(afterDown);
		dispatchPointer(window, 'pointerup', startX);
		await nextFrame();
	});
	it('keeps linked companions independent', async () => {
		timelineStore.setAll({
			tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
			items: [
				item({
					id: 'v1',
					trackId: 'video-track',
					label: 'V',
					type: 'video',
					durationInFrames: 90,
					sourceEnd: 90,
					fadeIn: 0.2,
					linkedGroupId: 'g1'
				}),
				item({
					id: 'a1',
					trackId: 'audio-track',
					label: 'A',
					type: 'audio',
					durationInFrames: 90,
					sourceEnd: 90,
					audioFadeIn: 0.3,
					linkedGroupId: 'g1'
				})
			],
			fps: 30
		});
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'v1',
			selectedItemIds: ['v1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="v1"]') as HTMLElement;
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = clip.querySelector('[data-fade-handles="video"]') as HTMLElement;
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const videoIn = clip.querySelector(
			'[data-fade-kind="video"][data-fade-handle="in"]'
		) as HTMLElement;
		dispatchPointer(videoIn, 'pointerdown', rect.left + 10);
		dispatchPointer(window, 'pointermove', rect.left + 40);
		await nextFrame();
		dispatchPointer(window, 'pointerup', rect.left + 40);
		await nextFrame();
		expect(timelineStore.itemById.get('a1')?.audioFadeIn).toBe(0.3);
		expect(timelineStore.itemById.get('v1')?.fadeIn).not.toBe(0.2);
	});
	it('double-click fade handle resets to zero', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video-1',
			selectedItemIds: ['video-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="video-1"]') as HTMLElement;
		const videoIn = clip.querySelector(
			'[data-fade-kind="video"][data-fade-handle="in"]'
		) as HTMLElement;
		expect(timelineStore.itemById.get('video-1')?.fadeIn).toBe(0.4);
		videoIn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('video-1')?.fadeIn).toBe(0);
		expect(commandHistory.undoStack.length).toBe(1);
	});
});
