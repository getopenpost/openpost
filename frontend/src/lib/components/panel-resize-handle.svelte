<script lang="ts">
	import {
		clampPanelResize,
		panelSizeFromArrowKey,
		panelSizeFromPointerDelta,
		type PanelResizeEdge
	} from './panel-resize';

	let {
		edge,
		value,
		minimum,
		maximum,
		defaultValue,
		label,
		onresize,
		oncommit = () => undefined,
		visibleFrom = 'lg',
		class: className = ''
	}: {
		edge: PanelResizeEdge;
		value: number;
		minimum: number;
		maximum: number;
		defaultValue: number;
		label: string;
		onresize: (value: number) => void;
		oncommit?: (value: number) => void;
		visibleFrom?: 'lg' | 'xl';
		class?: string;
	} = $props();

	const vertical = $derived(edge === 'left' || edge === 'right');
	const visibilityClass = $derived(visibleFrom === 'xl' ? 'hidden xl:flex' : 'hidden lg:flex');
	const positionClass = $derived(
		edge === 'right'
			? 'inset-y-0 -right-1 w-2 cursor-col-resize [@media(pointer:coarse)]:top-1/2 [@media(pointer:coarse)]:bottom-auto [@media(pointer:coarse)]:-right-5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-translate-y-1/2'
			: edge === 'left'
				? 'inset-y-0 -left-1 w-2 cursor-col-resize [@media(pointer:coarse)]:top-1/2 [@media(pointer:coarse)]:bottom-auto [@media(pointer:coarse)]:-left-5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-translate-y-1/2'
				: edge === 'bottom'
					? 'inset-x-0 -bottom-1 h-2 cursor-row-resize [@media(pointer:coarse)]:right-auto [@media(pointer:coarse)]:left-1/2 [@media(pointer:coarse)]:-bottom-5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-translate-x-1/2'
					: 'inset-x-0 -top-1 h-2 cursor-row-resize [@media(pointer:coarse)]:right-auto [@media(pointer:coarse)]:left-1/2 [@media(pointer:coarse)]:-top-5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:-translate-x-1/2'
	);

	function startResize(event: PointerEvent & { currentTarget: HTMLDivElement }): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const handle = event.currentTarget;
		const pointerId = event.pointerId;
		const startX = event.clientX;
		const startY = event.clientY;
		const startSize = value;
		let latestSize = startSize;
		handle.setPointerCapture(pointerId);

		const move = (moveEvent: PointerEvent): void => {
			latestSize = panelSizeFromPointerDelta(
				startSize,
				edge,
				moveEvent.clientX - startX,
				moveEvent.clientY - startY,
				minimum,
				maximum
			);
			onresize(latestSize);
		};
		const stop = (): void => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', stop);
			handle.removeEventListener('pointercancel', stop);
			oncommit(latestSize);
		};

		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', stop);
		handle.addEventListener('pointercancel', stop);
	}

	function resizeFromKeyboard(event: KeyboardEvent): void {
		const next = panelSizeFromArrowKey(value, edge, event.key, minimum, maximum);
		if (next === null) return;
		event.preventDefault();
		onresize(next);
		oncommit(next);
	}

	function resetSize(): void {
		const next = clampPanelResize(defaultValue, minimum, maximum);
		onresize(next);
		oncommit(next);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the focusable ARIA separator follows the Window Splitter pattern -->
<div
	class="group absolute z-[85] touch-none items-center justify-center border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--panel-resize-focus,oklch(0.66_0.14_45))] {visibilityClass} {positionClass} {className}"
	role="separator"
	tabindex="0"
	aria-label={label}
	aria-orientation={vertical ? 'vertical' : 'horizontal'}
	aria-valuemin={minimum}
	aria-valuemax={maximum}
	aria-valuenow={Math.round(value)}
	aria-valuetext={`${Math.round(value)} pixels`}
	onpointerdown={startResize}
	onkeydown={resizeFromKeyboard}
	ondblclick={resetSize}
>
	<span
		class="rounded-full bg-white/16 transition-colors group-hover:bg-white/40 group-focus-visible:bg-white/55 {vertical
			? 'h-10 w-0.5'
			: 'h-0.5 w-12'}"
		aria-hidden="true"
	></span>
</div>
