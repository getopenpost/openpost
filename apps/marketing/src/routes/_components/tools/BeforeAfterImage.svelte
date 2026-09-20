<script lang="ts">
	import { ChevronsLeftRight } from '@lucide/svelte';

	let {
		before,
		after,
		beforeAlt = 'Before',
		afterAlt = 'After',
		beforeLabel = 'Original',
		afterLabel = 'Result',
		value = $bindable(50),
		ariaLabel = 'Compare before and after images'
	}: {
		before: string;
		after: string;
		beforeAlt?: string;
		afterAlt?: string;
		beforeLabel?: string;
		afterLabel?: string;
		value?: number;
		ariaLabel?: string;
	} = $props();

	let dragging = $state(false);
	let comparisonElement = $state<HTMLDivElement>();

	function setValue(next: number): void {
		value = Math.round(Math.max(0, Math.min(100, next)));
	}

	function setFromPointer(element: HTMLElement, clientX: number): void {
		const bounds = element.getBoundingClientRect();
		if (!bounds.width) return;
		setValue(((clientX - bounds.left) / bounds.width) * 100);
	}

	function handleKey(event: KeyboardEvent): void {
		let next = value;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 1;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 1;
		else if (event.key === 'PageDown') next -= 10;
		else if (event.key === 'PageUp') next += 10;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = 100;
		else return;
		event.preventDefault();
		setValue(next);
	}
</script>

<div
	bind:this={comparisonElement}
	class="comparison focus-ring"
	class:dragging
	role="slider"
	tabindex="0"
	aria-label={ariaLabel}
	aria-valuemin="0"
	aria-valuemax="100"
	aria-valuenow={value}
	aria-valuetext={`${value}% ${afterLabel.toLowerCase()}`}
	aria-orientation="horizontal"
	onkeydown={handleKey}
	onpointerdown={(event) => {
		dragging = true;
		setFromPointer(comparisonElement!, event.clientX);
		comparisonElement?.focus();
		comparisonElement?.setPointerCapture(event.pointerId);
	}}
	onpointermove={(event) => {
		if (dragging) setFromPointer(comparisonElement!, event.clientX);
	}}
	onpointerup={(event) => {
		dragging = false;
		if (comparisonElement?.hasPointerCapture(event.pointerId)) {
			comparisonElement.releasePointerCapture(event.pointerId);
		}
	}}
	onpointercancel={() => (dragging = false)}
>
	<img src={before} alt={beforeAlt} draggable="false" />
	<div class="after checkerboard" style:clip-path={`inset(0 0 0 ${value}%)`}>
		<img src={after} alt={afterAlt} draggable="false" />
	</div>
	<span class="label before-label">{beforeLabel}</span>
	<span class="label after-label">{afterLabel}</span>
	<div class="divider" style:left={`${value}%`} aria-hidden="true">
		<span><ChevronsLeftRight size={18} strokeWidth={2.25} /></span>
	</div>
</div>

<style>
	.comparison {
		position: relative;
		display: grid;
		min-height: 300px;
		max-height: 620px;
		place-items: center;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--muted);
		cursor: ew-resize;
		touch-action: none;
		user-select: none;
	}
	.comparison > img,
	.after,
	.after img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.comparison > img {
		max-height: 620px;
	}
	.after {
		position: absolute;
		inset: 0;
	}
	.after img {
		position: absolute;
		inset: 0;
	}
	.checkerboard {
		background-color: var(--background);
		background-image:
			linear-gradient(45deg, var(--muted) 25%, transparent 25%),
			linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--muted) 75%),
			linear-gradient(-45deg, transparent 75%, var(--muted) 75%);
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
		background-size: 20px 20px;
	}
	.divider {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--background);
		box-shadow: 0 0 0 1px color-mix(in oklch, var(--foreground) 45%, transparent);
		transform: translateX(-1px);
	}
	.divider span {
		position: absolute;
		top: 50%;
		left: 50%;
		display: grid;
		width: 42px;
		height: 42px;
		place-items: center;
		border: 1px solid color-mix(in oklch, var(--foreground) 20%, var(--border));
		border-radius: 50%;
		background: var(--background);
		color: var(--foreground);
		box-shadow: 0 4px 16px color-mix(in oklch, var(--foreground) 18%, transparent);
		transform: translate(-50%, -50%);
	}
	.label {
		position: absolute;
		top: 12px;
		padding: 5px 9px;
		border-radius: 7px;
		background: color-mix(in oklch, var(--background) 90%, transparent);
		color: var(--foreground);
		font-size: 11px;
		font-weight: 600;
		line-height: 1;
		box-shadow: 0 0 0 1px color-mix(in oklch, var(--foreground) 12%, transparent);
		transition: opacity 120ms ease;
	}
	.before-label {
		left: 12px;
	}
	.after-label {
		right: 12px;
	}
	.dragging .label {
		opacity: 0.55;
	}
	@media (max-width: 480px) {
		.comparison {
			min-height: 260px;
		}
	}
	@media (pointer: coarse) {
		.divider span {
			width: 48px;
			height: 48px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.label {
			transition: none;
		}
	}
</style>
