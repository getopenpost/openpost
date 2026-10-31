<script module lang="ts">
	// Deterministic unique ids for suffix announcement wiring, one per instance.
	let nextSuffixId = 0;
</script>

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
		ariaDescribedBy,
		value,
		min,
		max,
		step = 1,
		precision = 2,
		valueWidth = '4.25rem',
		resetValue,
		placeholder = '',
		suffix = '',
		disabled = false,
		class: className = '',
		onbegin,
		onValueChange,
		onValueCommit,
		onValueCancel
	}: {
		ariaLabel: string;
		ariaDescribedBy?: string;
		/** Numeric model value; null renders `placeholder` (mixed selection). */
		value: number | null;
		min?: number;
		max?: number;
		step?: number;
		precision?: number;
		valueWidth?: string;
		resetValue?: number;
		placeholder?: string;
		/**
		 * Unit rendered after the value (e.g. "frames" shows "12 frames").
		 *
		 * Display-only: the unit is a sibling of the input, never part of the
		 * typed text, so typing "5" parses and commits 5 with no stripping.
		 * It stays visible while editing, is announced through
		 * aria-describedby, and yields to the mixed placeholder while the
		 * value is null with nothing being typed.
		 */
		suffix?: string;
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

	const suffixId = `scrub-field-suffix-${(nextSuffixId += 1)}`;
	// The unit stays visible while editing, but yields to the mixed placeholder.
	const suffixVisible = $derived(suffix !== '' && (draft !== null || value !== null));
	const describedBy = $derived.by(() => {
		const joined = [suffixVisible ? suffixId : null, ariaDescribedBy].filter(Boolean).join(' ');
		return joined === '' ? undefined : joined;
	});

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

	function handleDoubleClick(): void {
		if (!disabled && resetValue !== undefined) {
			beginGesture();
			onValueCommit?.(clampValue(resetValue, min, max));
			gestureActive = false;
		}
	}

	function handleInput(event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		const raw = event.currentTarget.value;
		draft = raw;
		const parsed = parseNumeric(raw);
		if (parsed === null) return;
		beginGesture();
		onValueChange?.(clampValue(parsed, min, max));
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
		} else if (event.key === 'PageUp' || event.key === 'PageDown') {
			event.preventDefault();
			const current = parseNumeric(draft ?? '') ?? value ?? 0;
			const direction = event.key === 'PageUp' ? 1 : -1;
			setLive(nudgeValue(current, direction, step * 10));
		} else if (event.key === 'Home' && min !== undefined) {
			event.preventDefault();
			setLive(min);
		} else if (event.key === 'End' && max !== undefined) {
			event.preventDefault();
			setLive(max);
		}
	}

	function handleKeyup(event: KeyboardEvent): void {
		event.stopPropagation();
		if (
			(event.key === 'ArrowUp' ||
				event.key === 'ArrowDown' ||
				event.key === 'PageUp' ||
				event.key === 'PageDown' ||
				event.key === 'Home' ||
				event.key === 'End') &&
			draft !== null
		) {
			commit();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -- decorative gesture wrapper extending the input's drag target; the input owns the ARIA contract -->
<span
	class="inline-flex shrink-0 cursor-ew-resize touch-none items-center select-none"
	onpointerdown={startScrub}
	onpointermove={moveScrub}
	onpointerup={finishScrub}
	onpointercancel={cancelScrub}
	ondblclick={handleDoubleClick}
>
	<Input
		bind:ref={input}
		type="text"
		inputmode="decimal"
		autocomplete="off"
		{disabled}
		aria-label={ariaLabel}
		aria-describedby={describedBy}
		{placeholder}
		value={displayValue}
		style="width: {valueWidth};"
		title={ariaLabel}
		class={cn(
			'h-[var(--editor-22,22px)] shrink-0 cursor-ew-resize touch-none px-1 text-right text-[11px] tabular-nums select-none focus:cursor-text focus:select-auto [@media(pointer:coarse)]:h-11',
			className
		)}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onkeyup={handleKeyup}
		onblur={(event) => {
			if (draft !== null) commit(event.currentTarget.value);
		}}
	/>
	{#if suffixVisible}
		<span
			id={suffixId}
			class="shrink-0 pl-0.5 text-[11px] whitespace-nowrap tabular-nums select-none"
			class:opacity-60={!disabled}
			class:opacity-35={disabled}>{suffix}</span
		>
	{/if}
</span>
