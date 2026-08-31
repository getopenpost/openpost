import { describe, expect, it, vi } from 'vitest';
import {
	createPointerGestureSessionHost,
	type PointerCaptureTarget,
	type PointerGestureEvent
} from './pointer-gesture-session';

class TestPointerEvent extends Event implements PointerGestureEvent {
	constructor(
		type: string,
		readonly pointerId: number,
		readonly clientX = 0,
		readonly clientY = 0
	) {
		super(type);
	}
}

class TestKeyboardEvent extends Event {
	constructor(
		type: string,
		readonly key: string
	) {
		super(type);
	}
}

class TestCaptureTarget extends EventTarget implements PointerCaptureTarget {
	readonly captures = new Set<number>();

	setPointerCapture(pointerId: number): void {
		this.captures.add(pointerId);
	}

	releasePointerCapture(pointerId: number): void {
		this.captures.delete(pointerId);
	}

	hasPointerCapture(pointerId: number): boolean {
		return this.captures.has(pointerId);
	}
}

function testHost() {
	const eventTarget = new EventTarget();
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrameId = 1;
	const host = createPointerGestureSessionHost({
		eventTarget,
		requestFrame(callback) {
			const frameId = nextFrameId++;
			frames.set(frameId, callback);
			return frameId;
		},
		cancelFrame(frameId) {
			frames.delete(frameId);
		}
	});
	return {
		eventTarget,
		host,
		flushFrame() {
			const frame = frames.entries().next().value;
			if (!frame) return;
			frames.delete(frame[0]);
			frame[1](0);
		}
	};
}

describe('pointer gesture session host', () => {
	it('owns one pointer and commits once after flushing its final move', () => {
		const { eventTarget, host } = testHost();
		const target = new TestCaptureTarget();
		const calls: string[] = [];
		host.start({
			pointerId: 4,
			target,
			onMove: () => calls.push('move'),
			onCommit: () => calls.push('commit'),
			onCancel: () => calls.push('cancel')
		});
		eventTarget.dispatchEvent(new TestPointerEvent('pointermove', 4));
		eventTarget.dispatchEvent(new TestPointerEvent('pointerup', 4));
		eventTarget.dispatchEvent(new TestPointerEvent('pointerup', 4));
		expect(calls).toEqual(['move', 'commit']);
		expect(target.captures.size).toBe(0);
		expect(host.activePointerId).toBeNull();
	});

	it('ignores non-owner pointers', () => {
		const { eventTarget, flushFrame, host } = testHost();
		const onMove = vi.fn();
		const onCommit = vi.fn();
		host.start({
			pointerId: 7,
			target: new TestCaptureTarget(),
			onMove,
			onCommit,
			onCancel: vi.fn()
		});
		eventTarget.dispatchEvent(new TestPointerEvent('pointermove', 8));
		eventTarget.dispatchEvent(new TestPointerEvent('pointerup', 8));
		flushFrame();
		expect(onMove).not.toHaveBeenCalled();
		expect(onCommit).not.toHaveBeenCalled();
		expect(host.activePointerId).toBe(7);
	});

	it.each([
		['pointercancel', 'cancel'],
		['lostpointercapture', 'lost-capture']
	] as const)('cancels on %s', (eventName, reason) => {
		const { eventTarget, host } = testHost();
		const target = new TestCaptureTarget();
		const onCancel = vi.fn();
		host.start({
			pointerId: 2,
			target,
			onMove: vi.fn(),
			onCommit: vi.fn(),
			onCancel
		});
		const event = new TestPointerEvent(eventName, 2);
		if (eventName === 'lostpointercapture') target.dispatchEvent(event);
		else eventTarget.dispatchEvent(event);
		expect(onCancel).toHaveBeenCalledWith(reason);
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it('cancels on Escape and removes listeners before later events', () => {
		const { eventTarget, host } = testHost();
		const onCancel = vi.fn();
		const onCommit = vi.fn();
		host.start({
			pointerId: 3,
			target: new TestCaptureTarget(),
			onMove: vi.fn(),
			onCommit,
			onCancel
		});
		eventTarget.dispatchEvent(new TestKeyboardEvent('keydown', 'Escape'));
		eventTarget.dispatchEvent(new TestPointerEvent('pointerup', 3));
		expect(onCancel).toHaveBeenCalledWith('escape');
		expect(onCancel).toHaveBeenCalledOnce();
		expect(onCommit).not.toHaveBeenCalled();
	});

	it('cancels exactly once on destroy', () => {
		const { eventTarget, host } = testHost();
		const onCancel = vi.fn();
		const onMove = vi.fn();
		host.start({
			pointerId: 11,
			target: new TestCaptureTarget(),
			onMove,
			onCommit: vi.fn(),
			onCancel
		});
		eventTarget.dispatchEvent(new TestPointerEvent('pointermove', 11));
		host.destroy();
		host.destroy();
		expect(onCancel).toHaveBeenCalledWith('destroy');
		expect(onCancel).toHaveBeenCalledOnce();
		expect(onMove).not.toHaveBeenCalled();
	});

	it('cancels the previous owner before a replacement starts', () => {
		const { host } = testHost();
		const firstCancel = vi.fn();
		host.start({
			pointerId: 1,
			target: new TestCaptureTarget(),
			onMove: vi.fn(),
			onCommit: vi.fn(),
			onCancel: firstCancel
		});
		host.start({
			pointerId: 9,
			target: new TestCaptureTarget(),
			onMove: vi.fn(),
			onCommit: vi.fn(),
			onCancel: vi.fn()
		});
		expect(firstCancel).toHaveBeenCalledWith('superseded');
		expect(firstCancel).toHaveBeenCalledOnce();
		expect(host.activePointerId).toBe(9);
	});

	it('cancels an active gesture when a queued move throws', () => {
		const { eventTarget, flushFrame, host } = testHost();
		const target = new TestCaptureTarget();
		const onCancel = vi.fn();
		host.start({
			pointerId: 15,
			target,
			onMove: () => {
				throw new Error('queued move failed');
			},
			onCommit: vi.fn(),
			onCancel
		});
		eventTarget.dispatchEvent(new TestPointerEvent('pointermove', 15));
		expect(flushFrame).toThrow('queued move failed');
		expect(onCancel).toHaveBeenCalledWith('cancel');
		expect(target.captures.size).toBe(0);
		expect(host.activePointerId).toBeNull();
	});
});
