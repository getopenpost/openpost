<script lang="ts">
	import MoveIcon from '@lucide/svelte/icons/move';

	interface CropRect {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	interface Props {
		sourceWidth: number;
		sourceHeight: number;
		crop: CropRect;
		label: string;
		onChange: (crop: CropRect) => void;
	}

	let { sourceWidth, sourceHeight, crop, label, onChange }: Props = $props();
	let dragging = $state(false);
	let start:
		| {
				pointerX: number;
				pointerY: number;
				cropX: number;
				cropY: number;
		  }
		| undefined;

	const left = $derived((crop.x / sourceWidth) * 100);
	const top = $derived((crop.y / sourceHeight) * 100);
	const width = $derived((crop.width / sourceWidth) * 100);
	const height = $derived((crop.height / sourceHeight) * 100);

	function beginDrag(event: PointerEvent) {
		if (event.button !== 0) return;
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		start = {
			pointerX: event.clientX,
			pointerY: event.clientY,
			cropX: crop.x,
			cropY: crop.y
		};
		dragging = true;
		event.preventDefault();
	}

	function moveCrop(event: PointerEvent) {
		if (!start || !dragging) return;
		const target = event.currentTarget as HTMLElement;
		const bounds = target.parentElement?.parentElement?.getBoundingClientRect();
		if (!bounds?.width || !bounds.height) return;
		updatePosition(
			start.cropX + ((event.clientX - start.pointerX) / bounds.width) * sourceWidth,
			start.cropY + ((event.clientY - start.pointerY) / bounds.height) * sourceHeight
		);
	}

	function endDrag(event: PointerEvent) {
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
		dragging = false;
		start = undefined;
	}

	function handleKeydown(event: KeyboardEvent) {
		const step = event.shiftKey ? 10 : 1;
		switch (event.key) {
			case 'ArrowLeft':
				updatePosition(crop.x - step, crop.y);
				break;
			case 'ArrowRight':
				updatePosition(crop.x + step, crop.y);
				break;
			case 'ArrowUp':
				updatePosition(crop.x, crop.y - step);
				break;
			case 'ArrowDown':
				updatePosition(crop.x, crop.y + step);
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	function updatePosition(x: number, y: number) {
		onChange({
			...crop,
			x: clamp(x, 0, sourceWidth - crop.width),
			y: clamp(y, 0, sourceHeight - crop.height)
		});
	}

	function clamp(value: number, minimum: number, maximum: number): number {
		return Math.min(maximum, Math.max(minimum, value));
	}
</script>

<div class="pointer-events-none absolute inset-0 overflow-hidden">
	<div
		class="absolute border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.58)]"
		style:left={`${left}%`}
		style:top={`${top}%`}
		style:width={`${width}%`}
		style:height={`${height}%`}
	>
		<div class="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-60">
			{#each Array(9) as _, index (index)}
				<div
					class="border-white/60 {index % 3 !== 2 ? 'border-r' : ''} {index < 6 ? 'border-b' : ''}"
				></div>
			{/each}
		</div>
		<button
			type="button"
			aria-label={label}
			class="pointer-events-auto absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full bg-black/70 text-white shadow outline-none focus-visible:ring-2 focus-visible:ring-primary {dragging
				? 'cursor-grabbing'
				: 'cursor-grab'}"
			onpointerdown={beginDrag}
			onpointermove={moveCrop}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onkeydown={handleKeydown}
		>
			<MoveIcon class="size-4" />
		</button>
	</div>
</div>
