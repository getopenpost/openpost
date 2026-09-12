<!--
	Hue-band strip for the secondary qualifier: drag across the rainbow to pick
	the key hue, with the core (hueWidth) and feather (hueSoftness) bands drawn
	around the center marker. Ported from FreeCut (MIT) `HueBandControl`.
	Pointer drags preview live through onlive and commit one undoable update
	through oncommit; keyboard arrows/Home/End commit directly.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { hueBandGeometry, hueFromStripPosition } from '$lib/video-editor/effects/hue-band';

	let {
		center,
		width,
		softness,
		disabled = false,
		label,
		onlive,
		oncommit
	}: {
		center: number;
		width: number;
		softness: number;
		disabled?: boolean;
		label: string;
		onlive: (center: number) => void;
		oncommit: (center: number) => void;
	} = $props();

	let control = $state<HTMLButtonElement | null>(null);
	let dragging = $state(false);
	let dragStartCenter = $state(0);
	/** Live center shown while dragging; null when the committed prop owns the view. */
	let liveCenter = $state<number | null>(null);
	let stripRect = $state<DOMRect | null>(null);
	let pendingLive: number | null = null;
	let liveRaf: number | null = null;

	const shownCenter = $derived(liveCenter ?? center);
	const geometry = $derived(hueBandGeometry(shownCenter, width, softness));

	function scheduleLive(next: number): void {
		pendingLive = next;
		if (liveRaf !== null) return;
		liveRaf = requestAnimationFrame(() => {
			liveRaf = null;
			const pending = pendingLive;
			pendingLive = null;
			if (pending !== null) onlive(pending);
		});
	}

	function cancelScheduledLive(): void {
		if (liveRaf !== null) cancelAnimationFrame(liveRaf);
		liveRaf = null;
		pendingLive = null;
	}

	function hueFromClient(clientX: number): number {
		const rect = stripRect ?? control?.getBoundingClientRect() ?? null;
		if (!rect || rect.width <= 0) return dragStartCenter;
		return hueFromStripPosition(clientX, rect.left, rect.width);
	}

	function handlePointerDown(event: PointerEvent): void {
		if (disabled || dragging || !control) return;
		event.preventDefault();
		try {
			control.setPointerCapture(event.pointerId);
		} catch {
			// Window-level listeners are not needed: the button keeps receiving moves.
		}
		stripRect = control.getBoundingClientRect();
		dragging = true;
		dragStartCenter = center;
		const next = hueFromClient(event.clientX);
		liveCenter = next;
		scheduleLive(next);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (disabled || !dragging) return;
		const next = hueFromClient(event.clientX);
		liveCenter = next;
		scheduleLive(next);
	}

	function handlePointerUp(event: PointerEvent): void {
		if (disabled || !dragging) return;
		const next = hueFromClient(event.clientX);
		cancelScheduledLive();
		dragging = false;
		stripRect = null;
		liveCenter = null;
		oncommit(next);
	}

	function handlePointerCancel(): void {
		if (!dragging) return;
		cancelScheduledLive();
		dragging = false;
		stripRect = null;
		liveCenter = null;
		oncommit(dragStartCenter);
	}

	function handleKeyDown(event: KeyboardEvent): void {
		if (disabled) return;
		let next: number | null = null;
		if (event.key === 'ArrowLeft') next = center - (event.shiftKey ? 10 : 1);
		else if (event.key === 'ArrowRight') next = center + (event.shiftKey ? 10 : 1);
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = 360;
		if (next === null) return;
		event.preventDefault();
		oncommit(Math.min(360, Math.max(0, next)));
	}
</script>

<button
	bind:this={control}
	type="button"
	{disabled}
	role="slider"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={360}
	aria-valuenow={Math.round(shownCenter)}
	aria-valuetext={`${Math.round(shownCenter)}°`}
	class={`hue-band relative h-8 w-full touch-none overflow-hidden rounded-sm border border-[var(--video-editor-border)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair'}`}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
	onkeydown={handleKeyDown}
>
	<span
		class="absolute inset-y-0 border-x border-white/35 bg-white/10"
		aria-hidden="true"
		style:left={`${geometry.softLeftPct}%`}
		style:right={`${geometry.softRightPct}%`}
	></span>
	<span
		class="absolute inset-y-0 border-x border-white/60 bg-white/20 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
		aria-hidden="true"
		style:left={`${geometry.coreLeftPct}%`}
		style:right={`${geometry.coreRightPct}%`}
	></span>
	<span
		class="absolute top-0 h-full w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.65)]"
		aria-hidden="true"
		style:left={`${geometry.centerPct}%`}
	></span>
	<span class="sr-only"
		>{m.video_editor_qualifier_hue_value({ degrees: Math.round(shownCenter) })}</span
	>
</button>

<style>
	.hue-band {
		background-image: linear-gradient(
			90deg,
			#ef4444,
			#f97316,
			#eab308,
			#22c55e,
			#06b6d4,
			#3b82f6,
			#8b5cf6,
			#ec4899,
			#ef4444
		);
	}
</style>
