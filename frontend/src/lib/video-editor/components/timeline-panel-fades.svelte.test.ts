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

function requireElement<T extends Element>(
	root: ParentNode,
	selector: string,
	constructor: abstract new (...args: never[]) => T
): T {
	const found = root.querySelector(selector);
	if (!(found instanceof constructor)) {
		throw new Error(`Expected ${constructor.name} for selector: ${selector}`);
	}
	return found;
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
	return new DOMRect(left, top, width, height);
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
		const audioClip = requireElement(
			screen.container,
			'[data-timeline-item-id="audio-1"]',
			HTMLElement
		);
		const audioInPath = requireElement(audioClip, '[data-fade-path="audio-in"]', SVGPathElement);
		requireElement(audioClip, '[data-fade-path="audio-out"]', SVGPathElement);
		expect(audioInPath.getAttribute('d')).not.toBe('');
		expect(audioInPath.getAttribute('d')).toContain('M');
		await screen.unmount();
		const screenVideo = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'video-1',
			selectedItemIds: ['video-1']
		});
		await nextFrame();
		const videoClip = requireElement(
			screenVideo.container,
			'[data-timeline-item-id="video-1"]',
			HTMLElement
		);
		const videoInPath = requireElement(videoClip, '[data-fade-path="video-in"]', SVGPathElement);
		requireElement(videoClip, '[data-fade-path="video-out"]', SVGPathElement);
		expect(videoInPath.getAttribute('d')).not.toBe('');
	});
	it('shows curve dots for audio fades and hides when fade is zero', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const audioClip = requireElement(
			screen.container,
			'[data-timeline-item-id="audio-1"]',
			HTMLElement
		);
		const inDot = requireElement(audioClip, '[data-fade-curve-dot="in"]', HTMLElement);
		requireElement(audioClip, '[data-fade-curve-dot="out"]', HTMLElement);
		expect(inDot.getAttribute('aria-label')).toMatch(/curve/i);
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
		const zeroClip = requireElement(
			screenZero.container,
			'[data-timeline-item-id="audio-1"]',
			HTMLElement
		);
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = requireElement(clip, '[data-fade-handles="audio"]', HTMLElement);
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const dot = requireElement(clip, '[data-fade-curve-dot="in"]', HTMLElement);
		const pathEl = requireElement(clip, '[data-fade-path="audio-in"]', SVGPathElement);
		const beforeD = pathEl.getAttribute('d');
		const beforeCurve = timelineStore.itemById.get('audio-1')?.audioFadeInCurve;
		const beforeX = timelineStore.itemById.get('audio-1')?.audioFadeInCurveX;
		dispatchPointer(dot, 'pointerdown', rect.left + 40, rect.top + 30);
		dispatchPointer(window, 'pointermove', rect.left + 90, rect.top + 10);
		await nextFrame();
		const midD = requireElement(clip, '[data-fade-path="audio-in"]', SVGPathElement).getAttribute(
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
		const midAfterD = requireElement(
			clip,
			'[data-fade-path="audio-in"]',
			SVGPathElement
		).getAttribute('d');
		commandHistory.undo();
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(beforeCurve);
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurveX).toBe(beforeX);
		expect(
			requireElement(clip, '[data-fade-path="audio-in"]', SVGPathElement).getAttribute('d')
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const dot = requireElement(clip, '[data-fade-curve-dot="in"]', HTMLElement);
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = requireElement(clip, '[data-fade-handles="audio"]', HTMLElement);
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		await nextFrame();
		const pathBefore = requireElement(
			clip,
			'[data-fade-path="audio-in"]',
			SVGPathElement
		).getAttribute('d');
		const audioIn = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLElement
		);
		const startX = rect.left + 50;
		const endX = rect.left + 100;
		dispatchPointer(audioIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', endX);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBeCloseTo(1, 1);
		expect(timelineStore.itemById.get('audio-1')?.audioFadeInCurve).toBe(0.7);
		const pathAfter = requireElement(
			clip,
			'[data-fade-path="audio-in"]',
			SVGPathElement
		).getAttribute('d');
		expect(pathAfter).not.toBe(pathBefore);
		dispatchPointer(window, 'pointerup', endX);
		await nextFrame();
		expect(commandHistory.undoStack).toHaveLength(1);
		const farX = rect.left + rect.width * 0.95;
		const audioIn2 = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLElement
		);
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		dispatchPointer(audioIn2, 'pointerdown', endX);
		dispatchPointer(window, 'pointermove', farX);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBeCloseTo(2.87, 2);
		expect(
			(timelineStore.itemById.get('audio-1')?.audioFadeIn ?? 0) +
				(timelineStore.itemById.get('audio-1')?.audioFadeOut ?? 0)
		).toBeGreaterThan(3);
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
		const clipNoOp = requireElement(
			screenNoOp.container,
			'[data-timeline-item-id="video-1"]',
			HTMLElement
		);
		const rectNoOp = fakeRect(300, 64, 100, 100);
		const fadeContainerNoOp = requireElement(clipNoOp, '[data-fade-handles="video"]', HTMLElement);
		vi.spyOn(fadeContainerNoOp, 'getBoundingClientRect').mockReturnValue(rectNoOp);
		const videoInNoOp = requireElement(
			clipNoOp,
			'[data-fade-kind="video"][data-fade-handle="in"]',
			HTMLElement
		);
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="video-1"]', HTMLElement);
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = requireElement(clip, '[data-fade-handles="video"]', HTMLElement);
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const videoIn = requireElement(
			clip,
			'[data-fade-kind="video"][data-fade-handle="in"]',
			HTMLElement
		);
		const startX = rect.left + 40;
		const pathBefore = requireElement(
			clip,
			'[data-fade-path="video-in"]',
			SVGPathElement
		).getAttribute('d');
		dispatchPointer(videoIn, 'pointerdown', startX);
		dispatchPointer(window, 'pointermove', startX + 30);
		await nextFrame();
		expect(
			requireElement(clip, '[data-fade-path="video-in"]', SVGPathElement).getAttribute('d')
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = requireElement(clip, '[data-fade-handles="audio"]', HTMLElement);
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const audioIn = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLElement
		);
		const dot = requireElement(clip, '[data-fade-curve-dot="in"]', HTMLElement);
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
	it('restores an active fade when its track becomes locked', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = screen.container.querySelector('[data-timeline-item-id="audio-1"]');
		if (!(clip instanceof HTMLElement)) throw new Error('Audio timeline clip is missing.');
		const fadeContainer = clip.querySelector('[data-fade-handles="audio"]');
		const audioIn = clip.querySelector('[data-fade-kind="audio"][data-fade-handle="in"]');
		if (!(fadeContainer instanceof HTMLElement) || !(audioIn instanceof HTMLButtonElement)) {
			throw new Error('Audio fade controls are missing.');
		}
		const rect = fakeRect();
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		dispatchPointer(audioIn, 'pointerdown', rect.left + 50);
		dispatchPointer(window, 'pointermove', rect.left + 200);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).not.toBe(0.5);

		timelineStore._setTracks([
			track('video-track', 'video', 0),
			{ ...track('audio-track', 'audio', 1), locked: true }
		]);
		await nextFrame();

		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(0.5);
		expect(commandHistory.undoStack).toHaveLength(0);
		const lockedAudioIn = screen.container.querySelector(
			'[data-timeline-item-id="audio-1"] [data-fade-kind="audio"][data-fade-handle="in"]'
		);
		if (!(lockedAudioIn instanceof HTMLButtonElement)) {
			throw new Error('Locked audio fade handle is missing.');
		}
		expect(lockedAudioIn.disabled).toBe(true);
	});
	it('supports keyboard for fade handles and curve dots with localized readouts', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const audioIn = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLElement
		);
		expect(audioIn.getAttribute('aria-label')).toMatch(/audio fade in/i);
		const before = timelineStore.itemById.get('audio-1')?.audioFadeIn ?? 0;
		audioIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBeCloseTo(before + 1 / 30, 2);
		expect(audioIn.getAttribute('aria-valuetext')).toMatch(/0\.\d/);
		audioIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(3);
		const dot = requireElement(clip, '[data-fade-curve-dot="in"]', HTMLElement);
		expect(dot.getAttribute('aria-label')).toMatch(/curve/i);
		const helpId = dot.getAttribute('aria-describedby');
		expect(helpId).toBeTruthy();
		expect(document.getElementById(helpId ?? '')?.textContent).toMatch(/Left and Right/);
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
	it('keeps the full 44px fade target hittable outside the clipped media content', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const handle = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLButtonElement
		);
		const clipRect = clip.getBoundingClientRect();
		const handleRect = handle.getBoundingClientRect();
		expect(handleRect.width).toBe(44);
		expect(handleRect.height).toBe(44);
		expect(handleRect.top).toBeLessThan(clipRect.top);
		const hit = document.elementFromPoint(handleRect.left + 22, handleRect.top + 2);
		expect(hit === handle || (hit instanceof Node && handle.contains(hit))).toBe(true);
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const handlesContainer = requireElement(clip, '[data-fade-handles-container]', HTMLElement);
		expect(handlesContainer.className).toContain('@min-[44px]:opacity-40');
		expect(handlesContainer.className).toContain('@min-[64px]:opacity-100');
		expect(handlesContainer.className).toContain('opacity-0');
		const handle = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLElement
		);
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
		const clipLocked = requireElement(
			screenLocked.container,
			'[data-timeline-item-id="audio-1"]',
			HTMLElement
		);
		const before = timelineStore.itemById.get('audio-1')?.audioFadeIn;
		const handleLocked = requireElement(
			clipLocked,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLButtonElement
		);
		expect(handleLocked.disabled).toBe(true);
		expect(handleLocked.tabIndex).toBe(-1);
		handleLocked.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, pointerId: 7 })
		);
		await nextFrame();
		expect(timelineStore.itemById.get('audio-1')?.audioFadeIn).toBe(before);
		expect(commandHistory.undoStack).toHaveLength(0);
	});
	it('remains usable at 320px without overflow', async () => {
		await page.viewport(320, 720);
		timelineStore._updateItems([{ id: 'audio-1', patch: { audioFadeIn: 0 } }]);
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
			document.documentElement.clientWidth
		);
		const handle = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLButtonElement
		);
		handle.dispatchEvent(new MouseEvent('mouseenter'));
		await nextFrame();
		const read = requireElement(clip, '[data-fade-readout]', HTMLElement);
		const readRect = read.getBoundingClientRect();
		expect(readRect.left).toBeGreaterThanOrEqual(-5);
		expect(readRect.right).toBeLessThanOrEqual(325);
	});
	it('respects pointerId ownership', async () => {
		const screen = await render(TimelinePanel, {
			onedit: vi.fn(),
			selectedItemId: 'audio-1',
			selectedItemIds: ['audio-1']
		});
		await nextFrame();
		const clip = requireElement(screen.container, '[data-timeline-item-id="audio-1"]', HTMLElement);
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = requireElement(clip, '[data-fade-handles="audio"]', HTMLElement);
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const audioIn = requireElement(
			clip,
			'[data-fade-kind="audio"][data-fade-handle="in"]',
			HTMLElement
		);
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="v1"]', HTMLElement);
		const rect = fakeRect(300, 64, 100, 100);
		const fadeContainer = requireElement(clip, '[data-fade-handles="video"]', HTMLElement);
		vi.spyOn(fadeContainer, 'getBoundingClientRect').mockReturnValue(rect);
		const videoIn = requireElement(
			clip,
			'[data-fade-kind="video"][data-fade-handle="in"]',
			HTMLElement
		);
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
		const clip = requireElement(screen.container, '[data-timeline-item-id="video-1"]', HTMLElement);
		const videoIn = requireElement(
			clip,
			'[data-fade-kind="video"][data-fade-handle="in"]',
			HTMLElement
		);
		expect(timelineStore.itemById.get('video-1')?.fadeIn).toBe(0.4);
		const bubbledClick = vi.fn();
		clip.addEventListener('click', bubbledClick);
		videoIn.click();
		expect(bubbledClick).not.toHaveBeenCalled();
		videoIn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await nextFrame();
		expect(timelineStore.itemById.get('video-1')?.fadeIn).toBe(0);
		expect(commandHistory.undoStack.length).toBe(1);
	});
});
