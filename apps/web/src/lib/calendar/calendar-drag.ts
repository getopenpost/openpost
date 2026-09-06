export const CALENDAR_DRAG_SLOT_MINUTES = 15;
export const CALENDAR_DRAG_MAX_ROTATION = 8;
export const CALENDAR_DRAG_EDGE_SIZE = 60;
export const CALENDAR_DRAG_MAX_SCROLL_SPEED = 720;

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const WEEK_DAY_COUNT = 7;
const TARGET_INSET_X = 4;
const TARGET_INSET_Y = 2;
const MAX_HORIZONTAL_LAG = 10;
const MAX_VERTICAL_LAG = 6;
const DRAG_ACTIVATION_DISTANCE = 5;
const VELOCITY_SMOOTHING = 0.24;
const POSITION_SMOOTHING = 0.55;
const ROTATION_SMOOTHING = 0.28;
const VELOCITY_DECAY = 0.86;
const DROP_DURATION = 220;

export type CalendarPoint = {
	x: number;
	y: number;
};

export type CalendarRect = {
	left: number;
	top: number;
	width: number;
	height: number;
};

export type WeekCalendarGeometry = {
	grid: CalendarRect;
	gutterWidth: number;
	hourHeight: number;
	targetHeight: number;
};

export type WeekCalendarTarget = {
	dayIndex: number;
	minutes: number;
	time: string;
	left: number;
	top: number;
	width: number;
	height: number;
};

export type WeekCalendarDragActivation<TItem, TTarget extends WeekCalendarTarget> = {
	item: TItem;
	sourceBounds: CalendarRect;
	target: TTarget | null;
};

export type WeekCalendarDragControllerOptions<TItem, TTarget extends WeekCalendarTarget> = {
	itemKey: (item: TItem) => string;
	resolveTarget: (pointer: CalendarPoint) => TTarget | null;
	targetKey: (target: TTarget | null) => string;
	getOverlayElement: () => HTMLElement | undefined;
	getScrollElement: () => HTMLElement | undefined;
	onActivate: (activation: WeekCalendarDragActivation<TItem, TTarget>) => void;
	onTargetChange: (item: TItem, target: TTarget | null) => void;
	onDrop: (item: TItem, target: TTarget) => void;
	onFinish: () => void;
	isSameTarget: (item: TItem, target: TTarget) => boolean;
};

type PointerDrag<TItem, TTarget extends WeekCalendarTarget> = {
	pointerId: number;
	item: TItem;
	sourceElement: HTMLButtonElement;
	grabOffset: CalendarPoint;
	pointer: CalendarPoint;
	startPointer: CalendarPoint;
	previousPointer: CalendarPoint;
	previousTime: number;
	velocity: CalendarPoint;
	visualPosition: CalendarPoint;
	rotation: number;
	lastFrameTime: number;
	target: TTarget | null;
	activated: boolean;
	reducedMotion: boolean;
};

export class WeekCalendarDragController<TItem, TTarget extends WeekCalendarTarget> {
	private drag: PointerDrag<TItem, TTarget> | null = null;
	private frame = 0;
	private dropAnimation: Animation | null = null;
	private suppressedClickKey = '';

	constructor(private readonly options: WeekCalendarDragControllerOptions<TItem, TTarget>) {}

	pointerDown(event: PointerEvent, item: TItem, enabled: boolean): void {
		if (
			event.button !== 0 ||
			!event.isPrimary ||
			!enabled ||
			this.dropAnimation ||
			!(event.currentTarget instanceof HTMLButtonElement)
		)
			return;

		this.cancel();
		const sourceElement = event.currentTarget;
		const bounds = sourceElement.getBoundingClientRect();
		const now = performance.now();
		sourceElement.setPointerCapture(event.pointerId);
		this.drag = {
			pointerId: event.pointerId,
			item,
			sourceElement,
			grabOffset: {
				x: event.clientX - bounds.left,
				y: event.clientY - bounds.top
			},
			pointer: { x: event.clientX, y: event.clientY },
			startPointer: { x: event.clientX, y: event.clientY },
			previousPointer: { x: event.clientX, y: event.clientY },
			previousTime: now,
			velocity: { x: 0, y: 0 },
			visualPosition: { x: bounds.left, y: bounds.top },
			rotation: 0,
			lastFrameTime: now,
			target: null,
			activated: false,
			reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
		};
	}

	pointerMove(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;

		if (!drag.activated) {
			const distance = Math.hypot(
				event.clientX - drag.startPointer.x,
				event.clientY - drag.startPointer.y
			);
			if (distance < DRAG_ACTIVATION_DISTANCE) return;
			this.activate(drag);
		}

		event.preventDefault();
		const now = performance.now();
		const elapsed = Math.max(8, now - drag.previousTime);
		const rawVelocity = {
			x: ((event.clientX - drag.previousPointer.x) / elapsed) * 1_000,
			y: ((event.clientY - drag.previousPointer.y) / elapsed) * 1_000
		};
		drag.velocity.x += (rawVelocity.x - drag.velocity.x) * VELOCITY_SMOOTHING;
		drag.velocity.y += (rawVelocity.y - drag.velocity.y) * VELOCITY_SMOOTHING;
		drag.pointer = { x: event.clientX, y: event.clientY };
		drag.previousPointer = drag.pointer;
		drag.previousTime = now;
		this.updateTarget(drag);
	}

	pointerUp(event: PointerEvent): void {
		const drag = this.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!drag.activated) {
			this.releasePointer(drag);
			this.drag = null;
			return;
		}

		event.preventDefault();
		this.finish(drag);
	}

	pointerCancel(event: PointerEvent): void {
		if (!this.drag || event.pointerId !== this.drag.pointerId) return;
		this.cancel();
	}

	pointerCaptureLost(event: PointerEvent): void {
		if (!this.drag || event.pointerId !== this.drag.pointerId) return;
		this.cancel();
	}

	keyDown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || (!this.drag?.activated && !this.dropAnimation)) return;
		event.preventDefault();
		event.stopPropagation();
		this.cancel();
	}

	consumeClick(item: TItem): boolean {
		if (this.suppressedClickKey !== this.options.itemKey(item)) return false;
		this.suppressedClickKey = '';
		return true;
	}

	cancel(): void {
		const hadActiveView = Boolean(this.dropAnimation || this.drag?.activated);
		if (this.frame) cancelAnimationFrame(this.frame);
		this.frame = 0;
		if (this.dropAnimation) {
			this.dropAnimation.onfinish = null;
			this.dropAnimation.cancel();
			this.dropAnimation = null;
		}
		if (this.drag) this.releasePointer(this.drag);
		this.drag = null;
		if (hadActiveView) this.options.onFinish();
	}

	destroy(): void {
		this.cancel();
	}

	private activate(drag: PointerDrag<TItem, TTarget>): void {
		drag.activated = true;
		drag.target = this.options.resolveTarget(drag.pointer);
		const bounds = drag.sourceElement.getBoundingClientRect();
		this.options.onActivate({
			item: drag.item,
			sourceBounds: {
				left: bounds.left,
				top: bounds.top,
				width: bounds.width,
				height: bounds.height
			},
			target: drag.target
		});
		this.scheduleFrame();
	}

	private updateTarget(drag: PointerDrag<TItem, TTarget>): void {
		const nextTarget = this.options.resolveTarget(drag.pointer);
		if (this.options.targetKey(nextTarget) === this.options.targetKey(drag.target)) return;
		drag.target = nextTarget;
		this.options.onTargetChange(drag.item, nextTarget);
	}

	private scheduleFrame(): void {
		if (this.frame) return;
		this.frame = requestAnimationFrame((now) => this.renderFrame(now));
	}

	private renderFrame(now: number): void {
		this.frame = 0;
		const drag = this.drag;
		if (!drag?.activated) return;
		const elapsed = Math.min(32, Math.max(1, now - drag.lastFrameTime));
		drag.lastFrameTime = now;

		const scrollElement = this.options.getScrollElement();
		if (scrollElement) {
			const scrollBounds = scrollElement.getBoundingClientRect();
			const scrollVelocity = calendarEdgeScrollVelocity(drag.pointer.y, {
				top: scrollBounds.top,
				bottom: scrollBounds.bottom
			});
			if (scrollVelocity !== 0) {
				const previousScrollTop = scrollElement.scrollTop;
				scrollElement.scrollTop += (scrollVelocity * elapsed) / 1_000;
				if (scrollElement.scrollTop !== previousScrollTop) this.updateTarget(drag);
			}
		}

		const desiredPosition = drag.reducedMotion
			? {
					x: drag.pointer.x - drag.grabOffset.x,
					y: drag.pointer.y - drag.grabOffset.y
				}
			: calendarDragVisualPosition(drag.pointer, drag.grabOffset, drag.velocity);
		const positionSmoothing = drag.reducedMotion ? 1 : POSITION_SMOOTHING;
		drag.visualPosition.x += (desiredPosition.x - drag.visualPosition.x) * positionSmoothing;
		drag.visualPosition.y += (desiredPosition.y - drag.visualPosition.y) * positionSmoothing;
		const desiredRotation = drag.reducedMotion ? 0 : calendarDragRotation(drag.velocity.x);
		drag.rotation +=
			(desiredRotation - drag.rotation) * (drag.reducedMotion ? 1 : ROTATION_SMOOTHING);
		const decay = Math.pow(VELOCITY_DECAY, elapsed / (1_000 / 60));
		drag.velocity.x *= decay;
		drag.velocity.y *= decay;

		const overlay = this.options.getOverlayElement();
		if (overlay) {
			overlay.style.transform = dragTransform(
				drag.visualPosition,
				drag.rotation,
				drag.reducedMotion ? 1.02 : 1.04
			);
		}
		this.scheduleFrame();
	}

	private finish(drag: PointerDrag<TItem, TTarget>): void {
		this.drag = null;
		if (this.frame) cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.releasePointer(drag);
		this.suppressClick(drag.item);

		const target = drag.target;
		const overlay = this.options.getOverlayElement();
		if (!target || !overlay || this.options.isSameTarget(drag.item, target)) {
			this.options.onFinish();
			return;
		}
		if (drag.reducedMotion) {
			this.commit(drag.item, target);
			return;
		}

		const overlayWidth = overlay.offsetWidth;
		const overlayHeight = overlay.offsetHeight;
		const landedScale = Math.min(1, target.width / overlayWidth, target.height / overlayHeight);
		const landedPosition = {
			x: target.left + (target.width - overlayWidth * landedScale) / 2,
			y: target.top + (target.height - overlayHeight * landedScale) / 2
		};
		const animation = overlay.animate(
			[
				{ transform: dragTransform(drag.visualPosition, drag.rotation, 1.04) },
				{ transform: dragTransform(landedPosition, 0, landedScale) }
			],
			{
				duration: DROP_DURATION,
				easing: 'cubic-bezier(0.18, 0.8, 0.2, 1)',
				fill: 'forwards'
			}
		);
		this.dropAnimation = animation;
		animation.onfinish = () => {
			animation.cancel();
			this.dropAnimation = null;
			this.commit(drag.item, target);
		};
		animation.oncancel = () => {
			if (this.dropAnimation === animation) this.dropAnimation = null;
		};
	}

	private commit(item: TItem, target: TTarget): void {
		this.options.onDrop(item, target);
		this.options.onFinish();
	}

	private suppressClick(item: TItem): void {
		const key = this.options.itemKey(item);
		this.suppressedClickKey = key;
		setTimeout(() => {
			if (this.suppressedClickKey === key) this.suppressedClickKey = '';
		}, 0);
	}

	private releasePointer(drag: PointerDrag<TItem, TTarget>): void {
		try {
			if (drag.sourceElement.hasPointerCapture(drag.pointerId)) {
				drag.sourceElement.releasePointerCapture(drag.pointerId);
			}
		} catch {
			// The browser may release capture before a cancellation event reaches the card.
		}
	}
}

export function resolveWeekCalendarTarget(
	pointer: CalendarPoint,
	geometry: WeekCalendarGeometry
): WeekCalendarTarget | null {
	const dayAreaWidth = geometry.grid.width - geometry.gutterWidth;
	const dayWidth = dayAreaWidth / WEEK_DAY_COUNT;
	if (dayWidth <= 0 || geometry.hourHeight <= 0) return null;

	const dayIndex = clamp(
		Math.floor((pointer.x - geometry.grid.left - geometry.gutterWidth) / dayWidth),
		0,
		WEEK_DAY_COUNT - 1
	);
	const rawMinutes = ((pointer.y - geometry.grid.top) / geometry.hourHeight) * MINUTES_PER_HOUR;
	const minutes = clamp(
		Math.round(rawMinutes / CALENDAR_DRAG_SLOT_MINUTES) * CALENDAR_DRAG_SLOT_MINUTES,
		0,
		MINUTES_PER_DAY - CALENDAR_DRAG_SLOT_MINUTES
	);

	return {
		dayIndex,
		minutes,
		time: formatCalendarMinutes(minutes),
		left: geometry.grid.left + geometry.gutterWidth + dayIndex * dayWidth + TARGET_INSET_X,
		top: geometry.grid.top + (minutes / MINUTES_PER_HOUR) * geometry.hourHeight + TARGET_INSET_Y,
		width: Math.max(0, dayWidth - TARGET_INSET_X * 2),
		height: geometry.targetHeight
	};
}

export function calendarDragRotation(velocityX: number): number {
	return clamp(velocityX * 0.007, -CALENDAR_DRAG_MAX_ROTATION, CALENDAR_DRAG_MAX_ROTATION);
}

export function calendarDragVisualPosition(
	pointer: CalendarPoint,
	grabOffset: CalendarPoint,
	velocity: CalendarPoint
): CalendarPoint {
	return {
		x:
			pointer.x - grabOffset.x - clamp(velocity.x * 0.012, -MAX_HORIZONTAL_LAG, MAX_HORIZONTAL_LAG),
		y: pointer.y - grabOffset.y - clamp(velocity.y * 0.006, -MAX_VERTICAL_LAG, MAX_VERTICAL_LAG)
	};
}

export function calendarEdgeScrollVelocity(
	pointerY: number,
	scrollBounds: { top: number; bottom: number }
): number {
	if (pointerY < scrollBounds.top + CALENDAR_DRAG_EDGE_SIZE) {
		const distance = Math.max(0, pointerY - scrollBounds.top);
		const strength = 1 - distance / CALENDAR_DRAG_EDGE_SIZE;
		return -Math.pow(strength, 1.6) * CALENDAR_DRAG_MAX_SCROLL_SPEED;
	}
	if (pointerY > scrollBounds.bottom - CALENDAR_DRAG_EDGE_SIZE) {
		const distance = Math.max(0, scrollBounds.bottom - pointerY);
		const strength = 1 - distance / CALENDAR_DRAG_EDGE_SIZE;
		return Math.pow(strength, 1.6) * CALENDAR_DRAG_MAX_SCROLL_SPEED;
	}
	return 0;
}

function formatCalendarMinutes(minutes: number): string {
	const hour = Math.floor(minutes / MINUTES_PER_HOUR);
	const minute = minutes % MINUTES_PER_HOUR;
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function dragTransform(position: CalendarPoint, rotation: number, scale: number): string {
	return `translate3d(${position.x}px, ${position.y}px, 0) rotate(${rotation.toFixed(2)}deg) scale(${scale})`;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
