<script lang="ts">
	import { cn } from '$lib/utils';
	import { clampValue, nudgeValue } from './scrub-math';

	const FULL_SWEEP_DEG = 270;
	const START_DEG = -135;

	let {
		ariaLabel,
		value,
		min = 0,
		max = 100,
		step = 1,
		size = 28,
		resetValue,
		disabled = false,
		class: className = '',
		onbegin,
		onValueChange,
		onValueCommit,
		onValueCancel
	}: {
		ariaLabel: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		size?: 20 | 28 | 40 | 56;
		resetValue?: number;
		disabled?: boolean;
		class?: string;
		onbegin?: () => void;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		onValueCancel?: () => void;
	} = $props();

	let knob = $state<HTMLElement | null>(null);
	let gestureActive = false;
	let drag: {
		pointerId: number;
		lastAngle: number;
		lastX: number;
		lastY: number;
		centerX: number;
		centerY: number;
		startValue: number;
		moved: boolean;
	} | null = null;

	const fraction = $derived(max === min ? 0 : (clampValue(value, min, max) - min) / (max - min));
	const pointerAngle = $derived(START_DEG + fraction * FULL_SWEEP_DEG);
	const range = $derived(max - min);

	function pointerAngleAt(
		clientX: number,
		clientY: number,
		centerX: number,
		centerY: number
	): number {
		return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
	}

	function angleDelta(from: number, to: number): number {
		let delta = to - from;
		while (delta > 180) delta -= 360;
		while (delta < -180) delta += 360;
		return delta;
	}

	function beginGesture(): void {
		if (gestureActive) return;
		gestureActive = true;
		onbegin?.();
	}

	function setLive(next: number): void {
		beginGesture();
		onValueChange?.(clampValue(next, min, max));
	}

	function commit(next: number): void {
		gestureActive = false;
		onValueCommit?.(clampValue(next, min, max));
	}

	function startDrag(event: PointerEvent): void {
		if (disabled || event.button !== 0 || !knob) return;
		event.preventDefault();
		knob.setPointerCapture(event.pointerId);
		const rect = knob.getBoundingClientRect();
		drag = {
			pointerId: event.pointerId,
			lastAngle: pointerAngleAt(
				event.clientX,
				event.clientY,
				rect.left + rect.width / 2,
				rect.top + rect.height / 2
			),
			lastX: event.clientX,
			lastY: event.clientY,
			centerX: rect.left + rect.width / 2,
			centerY: rect.top + rect.height / 2,
			startValue: value,
			moved: false
		};
	}

	function moveDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const speed = event.shiftKey ? 5 : event.altKey ? 0.2 : 1;
		const angle = pointerAngleAt(event.clientX, event.clientY, drag.centerX, drag.centerY);
		const circularDelta = (angleDelta(drag.lastAngle, angle) / FULL_SWEEP_DEG) * range;
		const linearDelta = ((drag.lastX - event.clientX - (event.clientY - drag.lastY)) / 150) * range;
		// Re-decide every move: the dominant gesture wins.
		const delta = Math.abs(circularDelta) >= Math.abs(linearDelta) ? circularDelta : linearDelta;
		drag.lastAngle = angle;
		drag.lastX = event.clientX;
		drag.lastY = event.clientY;
		if (delta === 0) return;
		drag.moved = true;
		setLive(value + delta * speed * step);
	}

	function finishDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const startValue = drag.startValue;
		const moved = drag.moved;
		drag = null;
		if (knob?.hasPointerCapture(event.pointerId)) knob.releasePointerCapture(event.pointerId);
		if (moved) commit(value);
		else {
			gestureActive = false;
			onValueChange?.(startValue);
		}
	}

	function cancelDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const startValue = drag.startValue;
		drag = null;
		gestureActive = false;
		onValueChange?.(startValue);
		onValueCancel?.();
	}
</script>

<div
	bind:this={knob}
	role="slider"
	tabindex={disabled ? -1 : 0}
	aria-label={ariaLabel}
	aria-valuenow={Math.round(value * 100) / 100}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-disabled={disabled}
	title={ariaLabel}
	style="width: {size}px; height: {size}px;"
	class={cn(
		'shrink-0 cursor-ns-resize touch-none rounded-full border bg-muted select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
		disabled && 'pointer-events-none opacity-50',
		className
	)}
	onpointerdown={startDrag}
	onpointermove={moveDrag}
	onpointerup={finishDrag}
	onpointercancel={cancelDrag}
	ondblclick={() => {
		if (!disabled && resetValue !== undefined) {
			beginGesture();
			commit(resetValue);
		}
	}}
	onkeydown={(event) => {
		if (disabled) return;
		if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
			event.preventDefault();
			event.stopPropagation();
			setLive(nudgeValue(value, 1, step, { shift: event.shiftKey, alt: event.altKey }, min, max));
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
			event.preventDefault();
			event.stopPropagation();
			setLive(nudgeValue(value, -1, step, { shift: event.shiftKey, alt: event.altKey }, min, max));
		} else if (event.key === 'Escape') {
			event.stopPropagation();
			gestureActive = false;
			onValueCancel?.();
			(event.currentTarget as HTMLElement).blur();
		}
	}}
	onkeyup={(event) => {
		if (event.key.startsWith('Arrow')) commit(value);
	}}
	onblur={() => {
		if (gestureActive) commit(value);
	}}
>
	<svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" class="block">
		<circle
			cx="10"
			cy="10"
			r="8.5"
			fill="none"
			stroke="currentColor"
			stroke-width="1"
			class="text-muted-foreground"
			opacity="0.35"
		/>
		<g transform="rotate({pointerAngle} 10 10)">
			<line
				x1="10"
				y1="10"
				x2="10"
				y2="3.5"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				class="text-foreground"
			/>
		</g>
		<circle cx="10" cy="10" r="1.4" fill="currentColor" class="text-foreground" />
	</svg>
</div>
