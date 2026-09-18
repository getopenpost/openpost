<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils';
	import {
		clampValue,
		formatFixed,
		nudgeValue,
		parseNumeric,
		scrubValue,
		stepsFromPixels
	} from './scrub-math';

	let {
		ariaLabel,
		value,
		min,
		max,
		step = 1,
		precision = 2,
		valueWidth = '4.25rem',
		resetValue,
		disabled = false,
		class: className = '',
		onbegin,
		onValueChange,
		onValueCommit,
		onValueCancel
	}: {
		ariaLabel: string;
		value: number | null;
		min?: number;
		max?: number;
		step?: number;
		precision?: number;
		valueWidth?: string;
		resetValue?: number;
		disabled?: boolean;
		class?: string;
		onbegin?: () => void;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		onValueCancel?: () => void;
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let draft = $state<string | null>(null);
	let gestureActive = false;
	let drag: { pointerId: number; startX: number; startValue: number; moved: boolean } | null = null;

	const displayValue = $derived(draft ?? (value === null ? '' : formatFixed(value, precision)));

	function beginGesture(): void {
		if (gestureActive) return;
		gestureActive = true;
		onbegin?.();
	}

	function setLive(next: number): void {
		beginGesture();
		const safe = clampValue(next, min, max);
		draft = formatFixed(safe, precision);
		onValueChange?.(safe);
	}

	function commit(raw: string = displayValue): void {
		const parsed = parseNumeric(raw);
		draft = null;
		gestureActive = false;
		if (parsed === null) {
			if (value !== null) onValueChange?.(value);
			onValueCancel?.();
			return;
		}
		onValueCommit?.(clampValue(parsed, min, max));
	}

	function revert(): void {
		draft = null;
		gestureActive = false;
		if (value !== null) onValueChange?.(value);
		// fallow-ignore-next-line code-duplication
		onValueCancel?.();
	}

	function startScrub(event: PointerEvent): void {
		if (disabled || event.button !== 0 || document.activeElement === input || !input) return;
		event.preventDefault();
		input.setPointerCapture(event.pointerId);
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startValue: value ?? 0,
			moved: false
		};
	}

	function moveScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const steps = stepsFromPixels(event.clientX - drag.startX, {
			shift: event.shiftKey,
			alt: event.altKey
		});
		if (steps === 0) return;
		drag.moved = true;
		setLive(
			scrubValue(drag.startValue, event.clientX - drag.startX, step, {
				shift: event.shiftKey,
				alt: event.altKey
			})
		);
	}

	function finishScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const moved = drag.moved;
		drag = null;
		if (input?.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
		if (moved) commit();
		else {
			input?.focus();
			input?.select();
		}
	}

	function cancelScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const moved = drag.moved;
		drag = null;
		if (moved) revert();
	}

	function handleInput(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		const raw = event.currentTarget.value;
		draft = raw;
		const parsed = parseNumeric(raw);
		// fallow-ignore-next-line code-duplication
		if (parsed !== null) setLive(parsed);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		event.stopPropagation();
		if (event.key === 'Enter') {
			if (draft !== null) commit(event.currentTarget.value);
			event.currentTarget.blur();
		} else if (event.key === 'Escape') {
			if (draft !== null) revert();
			event.currentTarget.blur();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const current = parseNumeric(draft ?? '') ?? value ?? 0;
			const direction = event.key === 'ArrowUp' ? 1 : -1;
			setLive(nudgeValue(current, direction, step, { shift: event.shiftKey, alt: event.altKey }));
		}
	}

	function handleKeyup(event: KeyboardEvent): void {
		event.stopPropagation();
		if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && draft !== null) commit();
	}
</script>

<Input
	bind:ref={input}
	type="text"
	inputmode="decimal"
	autocomplete="off"
	{disabled}
	aria-label={ariaLabel}
	value={displayValue}
	style="width: {valueWidth};"
	title={ariaLabel}
	class={cn(
		'h-[var(--editor-22,22px)] shrink-0 cursor-ew-resize touch-none px-1 text-right text-[11px] tabular-nums select-none focus:cursor-text focus:select-auto [@media(pointer:coarse)]:h-11',
		className
	)}
	onpointerdown={startScrub}
	onpointermove={moveScrub}
	onpointerup={finishScrub}
	onpointercancel={cancelScrub}
	ondblclick={() => {
		if (!disabled && resetValue !== undefined) {
			beginGesture();
			onValueCommit?.(clampValue(resetValue, min, max));
			gestureActive = false;
		}
	}}
	oninput={handleInput}
	onkeydown={handleKeydown}
	onkeyup={handleKeyup}
	onblur={(event) => {
		if (draft !== null) commit(event.currentTarget.value);
	}}
/>
