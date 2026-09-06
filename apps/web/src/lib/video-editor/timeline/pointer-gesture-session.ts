export type PointerGestureEndReason =
	| 'cancel'
	| 'escape'
	| 'lost-capture'
	| 'superseded'
	| 'destroy';

export interface PointerGestureEvent extends Event {
	readonly pointerId: number;
	readonly clientX: number;
	readonly clientY: number;
}

export interface PointerCaptureTarget extends EventTarget {
	setPointerCapture(pointerId: number): void;
	releasePointerCapture(pointerId: number): void;
	hasPointerCapture(pointerId: number): boolean;
}

interface KeyboardGestureEvent extends Event {
	readonly key: string;
}

export interface PointerGestureDefinition {
	pointerId: number;
	target: PointerCaptureTarget;
	onMove(event: PointerGestureEvent): void;
	onCommit(event: PointerGestureEvent): void;
	onCancel(reason: PointerGestureEndReason): void;
}

export interface PointerGestureSessionHost {
	start(definition: PointerGestureDefinition): boolean;
	cancel(reason?: PointerGestureEndReason): void;
	destroy(): void;
	readonly activePointerId: number | null;
}

interface PointerGestureSessionOptions {
	eventTarget: EventTarget;
	requestFrame(callback: FrameRequestCallback): number;
	cancelFrame(frameId: number): void;
}

interface ActivePointerGesture {
	definition: PointerGestureDefinition;
	pendingMove: PointerGestureEvent | null;
	frameId: number | null;
	cleanup: Array<() => void>;
	finished: boolean;
}

function hasPointerId(event: Event): event is PointerGestureEvent {
	return 'pointerId' in event && typeof event.pointerId === 'number';
}

function hasKey(event: Event): event is KeyboardGestureEvent {
	return 'key' in event && typeof event.key === 'string';
}

function capturePointer(target: PointerCaptureTarget, pointerId: number): void {
	try {
		target.setPointerCapture(pointerId);
	} catch {
		// Global listeners still own the gesture when capture is unavailable.
	}
}

function releasePointer(target: PointerCaptureTarget, pointerId: number): void {
	if (!target.hasPointerCapture(pointerId)) return;
	try {
		target.releasePointerCapture(pointerId);
	} catch {
		// Pointer capture may already be gone after node removal or pointer cancellation.
	}
}

export function createPointerGestureSessionHost(
	options: PointerGestureSessionOptions
): PointerGestureSessionHost {
	let active: ActivePointerGesture | null = null;

	function clean(session: ActivePointerGesture): void {
		if (session.frameId !== null) options.cancelFrame(session.frameId);
		session.frameId = null;
		session.pendingMove = null;
		for (const cleanup of session.cleanup.splice(0)) cleanup();
		releasePointer(session.definition.target, session.definition.pointerId);
	}

	function finish(
		session: ActivePointerGesture,
		outcome: { commit: PointerGestureEvent } | { cancel: PointerGestureEndReason }
	): void {
		if (session.finished || active !== session) return;
		session.finished = true;
		active = null;
		try {
			if ('commit' in outcome && session.pendingMove !== null) {
				if (session.frameId !== null) options.cancelFrame(session.frameId);
				session.frameId = null;
				const pendingMove = session.pendingMove;
				session.pendingMove = null;
				session.definition.onMove(pendingMove);
			}
		} finally {
			clean(session);
		}
		if ('commit' in outcome) session.definition.onCommit(outcome.commit);
		else session.definition.onCancel(outcome.cancel);
	}

	function start(definition: PointerGestureDefinition): boolean {
		if (active) finish(active, { cancel: 'superseded' });
		capturePointer(definition.target, definition.pointerId);
		const session: ActivePointerGesture = {
			definition,
			pendingMove: null,
			frameId: null,
			cleanup: [],
			finished: false
		};
		active = session;

		const onMove = (event: Event) => {
			if (!hasPointerId(event) || event.pointerId !== definition.pointerId) return;
			session.pendingMove = event;
			if (session.frameId !== null) return;
			session.frameId = options.requestFrame(() => {
				session.frameId = null;
				if (active !== session || session.pendingMove === null) return;
				const pendingMove = session.pendingMove;
				session.pendingMove = null;
				try {
					definition.onMove(pendingMove);
				} catch (error) {
					finish(session, { cancel: 'cancel' });
					throw error;
				}
			});
		};
		const onUp = (event: Event) => {
			if (hasPointerId(event) && event.pointerId === definition.pointerId) {
				finish(session, { commit: event });
			}
		};
		const onCancel = (event: Event) => {
			if (hasPointerId(event) && event.pointerId === definition.pointerId) {
				finish(session, { cancel: 'cancel' });
			}
		};
		const onLostCapture = (event: Event) => {
			if (hasPointerId(event) && event.pointerId === definition.pointerId) {
				finish(session, { cancel: 'lost-capture' });
			}
		};
		const onKeydown = (event: Event) => {
			if (hasKey(event) && event.key === 'Escape') finish(session, { cancel: 'escape' });
		};
		const listeners: Array<[EventTarget, string, EventListener]> = [
			[options.eventTarget, 'pointermove', onMove],
			[options.eventTarget, 'pointerup', onUp],
			[options.eventTarget, 'pointercancel', onCancel],
			[options.eventTarget, 'keydown', onKeydown],
			[definition.target, 'lostpointercapture', onLostCapture]
		];
		for (const [target, type, listener] of listeners) {
			target.addEventListener(type, listener);
			session.cleanup.push(() => target.removeEventListener(type, listener));
		}
		return true;
	}

	return {
		start,
		cancel(reason = 'cancel') {
			if (active) finish(active, { cancel: reason });
		},
		destroy() {
			if (active) finish(active, { cancel: 'destroy' });
		},
		get activePointerId() {
			return active?.definition.pointerId ?? null;
		}
	};
}

export function createBrowserPointerGestureSessionHost(): PointerGestureSessionHost {
	return createPointerGestureSessionHost({
		eventTarget: window,
		requestFrame: (callback) => window.requestAnimationFrame(callback),
		cancelFrame: (frameId) => window.cancelAnimationFrame(frameId)
	});
}
