<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	const SCRUB_THRESHOLD_PX = 3;

	let {
		ariaLabel,
		value,
		min,
		max,
		step = 1,
		decimals = 2,
		placeholder = '',
		disabled = false,
		class: className = '',
		onbegin,
		onlive,
		oncommit,
		oncancel
	}: {
		ariaLabel: string;
		value: number | null;
		min?: number;
		max?: number;
		step?: number;
		decimals?: number;
		placeholder?: string;
		disabled?: boolean;
		class?: string;
		onbegin?: () => void;
		onlive: (value: number) => void;
		oncommit: (value: number) => void;
		oncancel?: () => void;
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let draft = $state<string | null>(null);
	let drag: { pointerId: number; startX: number; startValue: number; scrubbed: boolean } | null =
		null;
	let gestureActive = false;
	const displayValue = $derived(draft ?? (value === null ? '' : value.toFixed(decimals)));

	function clamp(next: number): number {
		return Math.min(max ?? next, Math.max(min ?? next, next));
	}

	function beginGesture(): void {
		if (gestureActive) return;
		gestureActive = true;
		onbegin?.();
	}

	function setLive(next: number): void {
		beginGesture();
		const safe = clamp(next);
		draft = safe.toFixed(decimals);
		onlive(safe);
	}

	function commit(raw = displayValue): void {
		if (raw.trim() === '') {
			draft = null;
			gestureActive = false;
			return;
		}
		const parsed = Number(raw);
		draft = null;
		if (Number.isFinite(parsed)) oncommit(clamp(parsed));
		gestureActive = false;
	}

	function revert(): void {
		draft = null;
		if (value !== null) onlive(value);
		oncancel?.();
		gestureActive = false;
	}

	function startScrub(event: PointerEvent): void {
		if (disabled || event.button !== 0 || document.activeElement === input) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startValue: value ?? 0,
			scrubbed: false
		};
	}

	function moveScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const distance = event.clientX - drag.startX;
		if (!drag.scrubbed && Math.abs(distance) < SCRUB_THRESHOLD_PX) return;
		drag.scrubbed = true;
		setLive(drag.startValue + distance * step * (event.shiftKey ? 0.1 : 1));
	}

	function finishScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const scrubbed = drag.scrubbed;
		drag = null;
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (scrubbed) commit();
		else {
			input?.focus();
			input?.select();
		}
	}

	function cancelScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const scrubbed = drag.scrubbed;
		drag = null;
		if (scrubbed) revert();
	}

	function handleInput(event: Event): void {
		const raw = event.currentTarget.value;
		draft = raw;
		const parsed = Number(raw);
		if (Number.isFinite(parsed)) onlive(clamp(parsed));
	}

	function handleKeydown(event: KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'Enter') {
			if (draft !== null) commit(event.currentTarget.value);
			event.currentTarget.blur();
		} else if (event.key === 'Escape') {
			if (draft !== null) revert();
			event.currentTarget.blur();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const current = Number(draft ?? value ?? 0);
			const direction = event.key === 'ArrowUp' ? 1 : -1;
			setLive(current + direction * step * (event.shiftKey ? 10 : 1));
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
	{placeholder}
	value={displayValue}
	class="cursor-ew-resize touch-none select-none focus:cursor-text focus:select-auto {className}"
	onpointerdown={startScrub}
	onpointermove={moveScrub}
	onpointerup={finishScrub}
	onpointercancel={cancelScrub}
	oninput={handleInput}
	onkeydown={handleKeydown}
	onkeyup={handleKeyup}
	onblur={(event) => {
		if (draft !== null) commit(event.currentTarget.value);
	}}
/>
