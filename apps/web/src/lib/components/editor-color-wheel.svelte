<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	type WheelPointerEvent = PointerEvent & { currentTarget: HTMLButtonElement };
	type Position = { hue: number; amount: number };
	let {
		label,
		value,
		disabled = false,
		mixed = false,
		ringFill = 0,
		ringFrom = 0,
		onpreview,
		oncommit,
		oncancel
	}: {
		label: string;
		value: Position;
		disabled?: boolean;
		mixed?: boolean;
		ringFill?: number;
		ringFrom?: number;
		onpreview: (value: Position) => void;
		oncommit: (value: Position) => void;
		oncancel: () => void;
	} = $props();
	let pointer: number | null = null;
	let draft = $state<Position | null>(null);
	const current = $derived(draft ?? value);
	function position(event: WheelPointerEvent): Position {
		const bounds = event.currentTarget.getBoundingClientRect();
		const x = event.clientX - bounds.left - bounds.width / 2;
		const y = event.clientY - bounds.top - bounds.height / 2;
		return {
			hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
			amount: Math.min(1, Math.hypot(x, y) / Math.max(1, bounds.width / 2 - 5))
		};
	}
	function preview(event: WheelPointerEvent) {
		if (pointer !== event.pointerId) return;
		draft = position(event);
		onpreview(draft);
	}
	function cancel() {
		if (pointer === null) return;
		pointer = null;
		draft = null;
		oncancel();
	}
	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
			return;
		}
		let { hue, amount } = current;
		if (event.key === 'ArrowLeft') hue -= 1;
		else if (event.key === 'ArrowRight') hue += 1;
		else if (event.key === 'ArrowDown') amount -= 0.01;
		else if (event.key === 'ArrowUp') amount += 0.01;
		else if (event.key === 'Home') amount = 0;
		else if (event.key === 'End') amount = 1;
		else return;
		event.preventDefault();
		oncommit({ hue: (hue + 360) % 360, amount: Math.max(0, Math.min(1, amount)) });
	}
	onDestroy(cancel);
</script>

<button
	type="button"
	{disabled}
	class="color-wheel absolute inset-2 touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-45"
	data-editor-protected="color-wheel"
	style:--wheel-hue={`${current.hue}deg`}
	style:--wheel-amount={current.amount}
	style:--ring-fill={`${ringFill * 360}deg`}
	style:--ring-from={`${ringFrom}deg`}
	role="slider"
	aria-label={`${label} color wheel`}
	aria-valuemin="0"
	aria-valuemax="100"
	aria-valuenow={Math.round(current.amount * 100)}
	aria-valuetext={mixed
		? m.image_editor_mixed_value()
		: `${Math.round(current.hue)} degrees, ${Math.round(current.amount * 100)} percent`}
	onpointerdown={(event) => {
		if (disabled || event.button !== 0 || pointer !== null) return;
		event.preventDefault();
		pointer = event.pointerId;
		event.currentTarget.setPointerCapture(event.pointerId);
		preview(event);
	}}
	onpointermove={preview}
	onpointerup={(event) => {
		if (pointer !== event.pointerId) return;
		preview(event);
		const next = draft!;
		pointer = null;
		draft = null;
		oncommit(next);
		event.currentTarget.releasePointerCapture(event.pointerId);
	}}
	onpointercancel={cancel}
	onlostpointercapture={cancel}
	onkeydown={keydown}
>
	<span class="wheel-cross wheel-cross-x"></span><span class="wheel-cross wheel-cross-y"
	></span><span class="wheel-puck"></span>
	{#if mixed}<span class="wheel-mixed">{m.image_editor_mixed_value()}</span>{/if}
</button>

<style>
	.color-wheel {
		background:
			radial-gradient(
				circle closest-side,
				rgb(19 19 22 / 94%) 0%,
				rgb(19 19 22 / 90%) 62%,
				rgb(19 19 22 / 72%) 80%,
				rgb(19 19 22 / 25%) 88%,
				transparent 94%
			),
			conic-gradient(
				from 90deg,
				#ff3b30,
				#ff9500,
				#ffcc00,
				#34c759,
				#00c7be,
				#007aff,
				#5856d6,
				#ff2d55,
				#ff3b30
			);
		border: 1px solid rgb(255 255 255 / 18%);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 7%);
	}

	.color-wheel::before {
		position: absolute;
		inset: -8px;
		border-radius: 999px;
		background: conic-gradient(from var(--ring-from), #e4e4e9 var(--ring-fill), #060607 0);
		content: '';
		mask: radial-gradient(transparent 66%, black 68% 76%, transparent 78%);
		pointer-events: none;
	}

	.wheel-cross {
		position: absolute;
		background: rgb(255 255 255 / 14%);
		pointer-events: none;
	}

	.wheel-cross-x {
		top: 3%;
		bottom: 3%;
		left: 50%;
		width: 1px;
	}

	.wheel-cross-y {
		left: 3%;
		right: 3%;
		top: 50%;
		height: 1px;
	}

	.wheel-puck {
		position: absolute;
		left: calc(50% + cos(var(--wheel-hue)) * var(--wheel-amount) * 39%);
		top: calc(50% + sin(var(--wheel-hue)) * var(--wheel-amount) * 39%);
		width: 10px;
		height: 10px;
		translate: -50% -50%;
		border: 2px solid white;
		border-radius: 999px;
		background: #f8fafc;
		box-shadow: 0 1px 4px rgb(0 0 0 / 80%);
		pointer-events: none;
	}

	.wheel-mixed {
		position: absolute;
		inset: 35% 0 auto;
		color: white;
		font-size: 10px;
	}
</style>
