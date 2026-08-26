<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		captureSnapshot,
		restoreSnapshot,
		snapshotsEqual
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import {
		AUDIO_FADE_CURVE_X_DEFAULT,
		clampAudioFadeCurve,
		clampAudioFadeCurveX,
		clampFadeSeconds,
		fadeRatio,
		fadeSecondsFromOffset,
		getAudioFadeCurveControlPoint,
		getAudioFadeCurveFromOffset,
		getAudioFadeCurvePath,
		supportsAudioFade,
		supportsVisualFade,
		type CurveBias,
		type FadeHandle
	} from '$lib/video-editor/timeline/fade-handles';
	import type { TimelineItem } from '$lib/video-editor/project/types';

	let {
		item,
		selected = false,
		trackLocked = false,
		activeEditTool = null,
		onedit = () => {}
	}: {
		item: TimelineItem;
		selected?: boolean;
		trackLocked?: boolean;
		activeEditTool?: string | null;
		onedit?: () => void;
	} = $props();

	let container: HTMLDivElement | null = $state(null);
	let hovered: FadeHandle | null = $state(null);
	let editing: FadeHandle | null = $state(null);
	let curveEditing: FadeHandle | null = $state(null);

	let fadeDrag: {
		handle: FadeHandle;
		pointerId: number;
		beforeSnapshot: ReturnType<typeof captureSnapshot>;
		target: HTMLElement;
	} | null = $state(null);

	let curveDrag: {
		handle: FadeHandle;
		pointerId: number;
		beforeSnapshot: ReturnType<typeof captureSnapshot>;
		target: HTMLElement;
	} | null = $state(null);

	const isAudio = $derived(supportsAudioFade(item));
	const isVisual = $derived(supportsVisualFade(item));
	const fps = $derived(timelineStore.fps);
	const duration = $derived(item.durationInFrames);
	const liveItem = $derived(timelineStore.itemById.get(item.id) ?? item);

	const audioFadeIn = $derived(liveItem.type === 'audio' ? (liveItem.audioFadeIn ?? 0) : 0);
	const audioFadeOut = $derived(liveItem.type === 'audio' ? (liveItem.audioFadeOut ?? 0) : 0);
	const audioFadeInCurve = $derived(
		liveItem.type === 'audio' ? (liveItem.audioFadeInCurve ?? 0) : 0
	);
	const audioFadeOutCurve = $derived(
		liveItem.type === 'audio' ? (liveItem.audioFadeOutCurve ?? 0) : 0
	);
	const audioFadeInCurveX = $derived(
		liveItem.type === 'audio'
			? (liveItem.audioFadeInCurveX ?? AUDIO_FADE_CURVE_X_DEFAULT)
			: AUDIO_FADE_CURVE_X_DEFAULT
	);
	const audioFadeOutCurveX = $derived(
		liveItem.type === 'audio'
			? (liveItem.audioFadeOutCurveX ?? AUDIO_FADE_CURVE_X_DEFAULT)
			: AUDIO_FADE_CURVE_X_DEFAULT
	);
	const visualFadeIn = $derived(
		liveItem.type === 'video' || liveItem.type === 'composition' ? (liveItem.fadeIn ?? 0) : 0
	);
	const visualFadeOut = $derived(
		liveItem.type === 'video' || liveItem.type === 'composition' ? (liveItem.fadeOut ?? 0) : 0
	);

	const fadeIn = $derived(isAudio ? audioFadeIn : visualFadeIn);
	const fadeOut = $derived(isAudio ? audioFadeOut : visualFadeOut);

	const fadeInRatio = $derived(fadeRatio(fadeIn, fps, duration));
	const fadeOutRatio = $derived(fadeRatio(fadeOut, fps, duration));
	const fadeInPercent = $derived(fadeInRatio * 100);
	const fadeOutPercent = $derived(fadeOutRatio * 100);
	const fadeOutLeft = $derived(100 - fadeOutPercent);

	const FADE_VIEWBOX_WIDTH = 1000;
	const FADE_VIEWBOX_HEIGHT = 100;

	const audioFadeInViewboxWidth = $derived(fadeInRatio * FADE_VIEWBOX_WIDTH);
	const audioFadeOutViewboxWidth = $derived(fadeOutRatio * FADE_VIEWBOX_WIDTH);
	const videoFadeInViewboxWidth = $derived(fadeInRatio * FADE_VIEWBOX_WIDTH);
	const videoFadeOutViewboxWidth = $derived(fadeOutRatio * FADE_VIEWBOX_WIDTH);

	const audioFadeInCurvePath = $derived(
		isAudio
			? getAudioFadeCurvePath({
					handle: 'in',
					fadePixels: audioFadeInViewboxWidth,
					clipWidthPixels: FADE_VIEWBOX_WIDTH,
					curve: audioFadeInCurve,
					curveX: audioFadeInCurveX
				})
			: ''
	);
	const audioFadeOutCurvePath = $derived(
		isAudio
			? getAudioFadeCurvePath({
					handle: 'out',
					fadePixels: audioFadeOutViewboxWidth,
					clipWidthPixels: FADE_VIEWBOX_WIDTH,
					curve: audioFadeOutCurve,
					curveX: audioFadeOutCurveX
				})
			: ''
	);
	const videoFadeInPath = $derived(
		isVisual
			? getAudioFadeCurvePath({
					handle: 'in',
					fadePixels: videoFadeInViewboxWidth,
					clipWidthPixels: FADE_VIEWBOX_WIDTH,
					curve: 0,
					curveX: AUDIO_FADE_CURVE_X_DEFAULT
				})
			: ''
	);
	const videoFadeOutPath = $derived(
		isVisual
			? getAudioFadeCurvePath({
					handle: 'out',
					fadePixels: videoFadeOutViewboxWidth,
					clipWidthPixels: FADE_VIEWBOX_WIDTH,
					curve: 0,
					curveX: AUDIO_FADE_CURVE_X_DEFAULT
				})
			: ''
	);

	const audioFadeInCurvePoint = $derived(
		isAudio && fadeInRatio > 0
			? getAudioFadeCurveControlPoint({
					handle: 'in',
					fadePixels: audioFadeInViewboxWidth,
					clipWidthPixels: FADE_VIEWBOX_WIDTH,
					curve: audioFadeInCurve,
					curveX: audioFadeInCurveX
				})
			: null
	);
	const audioFadeOutCurvePoint = $derived(
		isAudio && fadeOutRatio > 0
			? getAudioFadeCurveControlPoint({
					handle: 'out',
					fadePixels: audioFadeOutViewboxWidth,
					clipWidthPixels: FADE_VIEWBOX_WIDTH,
					curve: audioFadeOutCurve,
					curveX: audioFadeOutCurveX
				})
			: null
	);

	const canInteract = $derived(!trackLocked && activeEditTool === null);
	const isAnyEditing = $derived(editing !== null || curveEditing !== null);
	const handleVisibilityClass = $derived(
		editing !== null || curveEditing !== null || selected
			? 'opacity-100'
			: 'opacity-0 group-hover/timeline-item:opacity-100'
	);
	const densityVisibilityClass = $derived(
		isAnyEditing ? 'opacity-100' : 'opacity-0 @min-[44px]:opacity-40 @min-[64px]:opacity-100'
	);
	const densityPointerClass = $derived(
		isAnyEditing ? 'pointer-events-auto' : 'pointer-events-none @min-[44px]:pointer-events-auto'
	);

	const keyboardHelp = $derived(m.video_editor_fade_handle_keyboard());

	function otherFade(handle: FadeHandle): number {
		return handle === 'in' ? fadeOut : fadeIn;
	}

	function commitFade(handle: FadeHandle, nextSeconds: number): void {
		const clamped = clampFadeSeconds(nextSeconds, otherFade(handle), duration, fps);
		if (isAudio) {
			const patch: Partial<TimelineItem> = {};
			if (handle === 'in') patch.audioFadeIn = clamped;
			else patch.audioFadeOut = clamped;
			timelineStore._updateItems([{ id: item.id, patch }]);
		} else if (isVisual) {
			const patch: Partial<TimelineItem> = {};
			if (handle === 'in') patch.fadeIn = clamped;
			else patch.fadeOut = clamped;
			timelineStore._updateItems([{ id: item.id, patch }]);
		}
	}

	function computeFadeSeconds(clientX: number, handle: FadeHandle): number {
		if (!container) return handle === 'in' ? fadeIn : fadeOut;
		const rect = container.getBoundingClientRect();
		if (rect.width <= 0) return handle === 'in' ? fadeIn : fadeOut;
		const offset = clientX - rect.left;
		const raw = fadeSecondsFromOffset({
			handle,
			clipWidthPixels: rect.width,
			pointerOffsetPixels: offset,
			fps,
			maxDurationFrames: duration
		});
		return clampFadeSeconds(raw, otherFade(handle), duration, fps);
	}

	function cleanupFadeDrag(): void {
		if (!fadeDrag) return;
		const completed = fadeDrag;
		fadeDrag = null;
		editing = null;
		window.removeEventListener('pointermove', onFadePointerMove);
		window.removeEventListener('pointerup', onFadePointerUp);
		window.removeEventListener('pointercancel', onFadePointerCancel);
		window.removeEventListener('keydown', onFadeKeyEscape);
		completed.target.removeEventListener('lostpointercapture', onFadeLostCapture);
		try {
			if (completed.target.hasPointerCapture(completed.pointerId))
				completed.target.releasePointerCapture(completed.pointerId);
		} catch {
			// synthetic events may not support capture
		}
	}

	function onFadePointerMove(event: PointerEvent): void {
		if (!fadeDrag || event.pointerId !== fadeDrag.pointerId) return;
		const next = computeFadeSeconds(event.clientX, fadeDrag.handle);
		commitFade(fadeDrag.handle, next);
	}

	function finishFadeDrag(cancelled: boolean): void {
		if (!fadeDrag) return;
		const before = fadeDrag.beforeSnapshot;
		const handle = fadeDrag.handle;
		cleanupFadeDrag();
		if (cancelled) {
			restoreSnapshot(before);
			return;
		}
		const after = captureSnapshot();
		if (snapshotsEqual(before, after)) return;
		const type = isAudio
			? handle === 'in'
				? 'UPDATE_AUDIO_FADE_IN'
				: 'UPDATE_AUDIO_FADE_OUT'
			: handle === 'in'
				? 'UPDATE_VIDEO_FADE_IN'
				: 'UPDATE_VIDEO_FADE_OUT';
		commandHistory.addUndoEntry({ type }, before);
		onedit();
	}

	function onFadePointerUp(event: PointerEvent): void {
		if (!fadeDrag || event.pointerId !== fadeDrag.pointerId) return;
		const next = computeFadeSeconds(event.clientX, fadeDrag.handle);
		commitFade(fadeDrag.handle, next);
		finishFadeDrag(false);
	}

	function onFadePointerCancel(event: PointerEvent): void {
		if (!fadeDrag || event.pointerId !== fadeDrag.pointerId) return;
		finishFadeDrag(true);
	}

	function onFadeLostCapture(event: PointerEvent): void {
		if (!fadeDrag || event.pointerId !== fadeDrag.pointerId) return;
		finishFadeDrag(true);
	}

	function onFadeKeyEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !fadeDrag) return;
		event.preventDefault();
		finishFadeDrag(true);
	}

	function startFadePointerDown(
		event: PointerEvent & { currentTarget: HTMLButtonElement },
		handle: FadeHandle
	): void {
		if (event.button !== 0 || !canInteract || fadeDrag || curveDrag) return;
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		const before = captureSnapshot();
		fadeDrag = { handle, pointerId: event.pointerId, beforeSnapshot: before, target };
		editing = handle;
		hovered = handle;
		try {
			target.setPointerCapture(event.pointerId);
		} catch {
			// ignore
		}
		target.addEventListener('lostpointercapture', onFadeLostCapture);
		window.addEventListener('pointermove', onFadePointerMove);
		window.addEventListener('pointerup', onFadePointerUp);
		window.addEventListener('pointercancel', onFadePointerCancel);
		window.addEventListener('keydown', onFadeKeyEscape);
		const next = computeFadeSeconds(event.clientX, handle);
		commitFade(handle, next);
	}

	function commitCurve(handle: FadeHandle, curve: number, curveX: number): void {
		const clampedCurve = clampAudioFadeCurve(curve);
		const clampedX = clampAudioFadeCurveX(curveX);
		const patch: Partial<TimelineItem> = {};
		if (handle === 'in') {
			patch.audioFadeInCurve = clampedCurve;
			patch.audioFadeInCurveX = clampedX;
		} else {
			patch.audioFadeOutCurve = clampedCurve;
			patch.audioFadeOutCurveX = clampedX;
		}
		timelineStore._updateItems([{ id: item.id, patch }]);
	}

	function computeCurve(clientX: number, clientY: number, handle: FadeHandle): CurveBias {
		if (!container) return { curve: 0, curveX: AUDIO_FADE_CURVE_X_DEFAULT };
		const rect = container.getBoundingClientRect();
		const ratio = handle === 'in' ? fadeInRatio : fadeOutRatio;
		const fadePixels = ratio * rect.width;
		if (fadePixels <= 0 || rect.height <= 0)
			return { curve: 0, curveX: AUDIO_FADE_CURVE_X_DEFAULT };
		return getAudioFadeCurveFromOffset({
			handle,
			pointerOffsetX: clientX - rect.left,
			pointerOffsetY: clientY - rect.top,
			fadePixels,
			clipWidthPixels: rect.width,
			rowHeight: rect.height
		});
	}

	function cleanupCurveDrag(): void {
		if (!curveDrag) return;
		const completed = curveDrag;
		curveDrag = null;
		curveEditing = null;
		window.removeEventListener('pointermove', onCurvePointerMove);
		window.removeEventListener('pointerup', onCurvePointerUp);
		window.removeEventListener('pointercancel', onCurvePointerCancel);
		window.removeEventListener('keydown', onCurveKeyEscape);
		completed.target.removeEventListener('lostpointercapture', onCurveLostCapture);
		try {
			if (completed.target.hasPointerCapture(completed.pointerId))
				completed.target.releasePointerCapture(completed.pointerId);
		} catch {
			// ignore
		}
	}

	function onCurvePointerMove(event: PointerEvent): void {
		if (!curveDrag || event.pointerId !== curveDrag.pointerId) return;
		const next = computeCurve(event.clientX, event.clientY, curveDrag.handle);
		commitCurve(curveDrag.handle, next.curve, next.curveX);
	}

	function finishCurveDrag(cancelled: boolean): void {
		if (!curveDrag) return;
		const before = curveDrag.beforeSnapshot;
		cleanupCurveDrag();
		if (cancelled) {
			restoreSnapshot(before);
			return;
		}
		const after = captureSnapshot();
		if (snapshotsEqual(before, after)) return;
		commandHistory.addUndoEntry({ type: 'UPDATE_AUDIO_FADE_CURVE' }, before);
		onedit();
	}

	function onCurvePointerUp(event: PointerEvent): void {
		if (!curveDrag || event.pointerId !== curveDrag.pointerId) return;
		const next = computeCurve(event.clientX, event.clientY, curveDrag.handle);
		commitCurve(curveDrag.handle, next.curve, next.curveX);
		finishCurveDrag(false);
	}

	function onCurvePointerCancel(event: PointerEvent): void {
		if (!curveDrag || event.pointerId !== curveDrag.pointerId) return;
		finishCurveDrag(true);
	}

	function onCurveLostCapture(event: PointerEvent): void {
		if (!curveDrag || event.pointerId !== curveDrag.pointerId) return;
		finishCurveDrag(true);
	}

	function onCurveKeyEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !curveDrag) return;
		event.preventDefault();
		finishCurveDrag(true);
	}

	function startCurvePointerDown(
		event: PointerEvent & { currentTarget: HTMLButtonElement },
		handle: FadeHandle
	): void {
		if (event.button !== 0 || !canInteract || fadeDrag || curveDrag) return;
		const ratio = handle === 'in' ? fadeInRatio : fadeOutRatio;
		if (ratio <= 0) return;
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		const before = captureSnapshot();
		curveDrag = { handle, pointerId: event.pointerId, beforeSnapshot: before, target };
		curveEditing = handle;
		hovered = handle;
		try {
			target.setPointerCapture(event.pointerId);
		} catch {
			// ignore
		}
		target.addEventListener('lostpointercapture', onCurveLostCapture);
		window.addEventListener('pointermove', onCurvePointerMove);
		window.addEventListener('pointerup', onCurvePointerUp);
		window.addEventListener('pointercancel', onCurvePointerCancel);
		window.addEventListener('keydown', onCurveKeyEscape);
		const next = computeCurve(event.clientX, event.clientY, handle);
		commitCurve(handle, next.curve, next.curveX);
	}

	function adjustFadeWithKeyboard(event: KeyboardEvent, handle: FadeHandle): void {
		if (!canInteract) return;
		const stepFrames = event.shiftKey ? 10 : 1;
		const stepSeconds = fps > 0 ? stepFrames / fps : 0.033;
		let delta = 0;
		if (event.key === 'ArrowLeft') delta = handle === 'in' ? -stepSeconds : stepSeconds;
		else if (event.key === 'ArrowRight') delta = handle === 'in' ? stepSeconds : -stepSeconds;
		else if (event.key === 'ArrowUp') delta = stepSeconds;
		else if (event.key === 'ArrowDown') delta = -stepSeconds;
		else if (event.key === 'Home') {
			event.preventDefault();
			const before = captureSnapshot();
			commitFade(handle, 0);
			const after = captureSnapshot();
			if (!snapshotsEqual(before, after)) {
				commandHistory.addUndoEntry({ type: 'UPDATE_FADE_KEYBOARD' }, before);
				onedit();
			}
			return;
		} else if (event.key === 'End') {
			event.preventDefault();
			const before = captureSnapshot();
			const max = duration > 0 && fps > 0 ? duration / fps - otherFade(handle) : 5;
			commitFade(handle, Math.max(0, max));
			const after = captureSnapshot();
			if (!snapshotsEqual(before, after)) {
				commandHistory.addUndoEntry({ type: 'UPDATE_FADE_KEYBOARD' }, before);
				onedit();
			}
			return;
		} else return;
		event.preventDefault();
		const before = captureSnapshot();
		const current = handle === 'in' ? fadeIn : fadeOut;
		commitFade(handle, current + delta);
		const after = captureSnapshot();
		if (!snapshotsEqual(before, after)) {
			commandHistory.addUndoEntry({ type: 'UPDATE_FADE_KEYBOARD' }, before);
			onedit();
		}
	}

	function adjustCurveWithKeyboard(event: KeyboardEvent, handle: FadeHandle): void {
		if (!canInteract) return;
		const rawCurve = handle === 'in' ? audioFadeInCurve : audioFadeOutCurve;
		const rawX = handle === 'in' ? audioFadeInCurveX : audioFadeOutCurveX;
		let nextCurve = rawCurve;
		let nextX = rawX;
		const curveStep = event.shiftKey ? 0.1 : 0.05;
		const biasStep = event.shiftKey ? 0.04 : 0.02;
		if (event.key === 'ArrowLeft') nextX -= biasStep;
		else if (event.key === 'ArrowRight') nextX += biasStep;
		else if (event.key === 'ArrowUp') nextCurve += curveStep;
		else if (event.key === 'ArrowDown') nextCurve -= curveStep;
		else if (event.key === 'Home') {
			event.preventDefault();
			const before = captureSnapshot();
			commitCurve(handle, 0, AUDIO_FADE_CURVE_X_DEFAULT);
			const after = captureSnapshot();
			if (!snapshotsEqual(before, after)) {
				commandHistory.addUndoEntry({ type: 'UPDATE_AUDIO_FADE_CURVE_KEYBOARD' }, before);
				onedit();
			}
			return;
		} else if (event.key === 'End') {
			event.preventDefault();
			const before = captureSnapshot();
			commitCurve(handle, 1, 0.96);
			const after = captureSnapshot();
			if (!snapshotsEqual(before, after)) {
				commandHistory.addUndoEntry({ type: 'UPDATE_AUDIO_FADE_CURVE_KEYBOARD' }, before);
				onedit();
			}
			return;
		} else return;
		event.preventDefault();
		const before = captureSnapshot();
		commitCurve(handle, nextCurve, nextX);
		const after = captureSnapshot();
		if (!snapshotsEqual(before, after)) {
			commandHistory.addUndoEntry({ type: 'UPDATE_AUDIO_FADE_CURVE_KEYBOARD' }, before);
			onedit();
		}
	}

	function resetFade(handle: FadeHandle): void {
		if (!canInteract) return;
		const current = handle === 'in' ? fadeIn : fadeOut;
		if (current === 0) return;
		const before = captureSnapshot();
		commitFade(handle, 0);
		const after = captureSnapshot();
		if (!snapshotsEqual(before, after)) {
			commandHistory.addUndoEntry({ type: 'RESET_FADE' }, before);
			onedit();
		}
	}

	function resetCurve(handle: FadeHandle): void {
		if (!canInteract) return;
		const cur = handle === 'in' ? audioFadeInCurve : audioFadeOutCurve;
		const curX = handle === 'in' ? audioFadeInCurveX : audioFadeOutCurveX;
		if (cur === 0 && Math.abs(curX - AUDIO_FADE_CURVE_X_DEFAULT) < 0.001) return;
		const before = captureSnapshot();
		commitCurve(handle, 0, AUDIO_FADE_CURVE_X_DEFAULT);
		const after = captureSnapshot();
		if (!snapshotsEqual(before, after)) {
			commandHistory.addUndoEntry({ type: 'RESET_AUDIO_FADE_CURVE' }, before);
			onedit();
		}
	}

	onDestroy(() => {
		if (fadeDrag) {
			restoreSnapshot(fadeDrag.beforeSnapshot);
			cleanupFadeDrag();
		}
		if (curveDrag) {
			restoreSnapshot(curveDrag.beforeSnapshot);
			cleanupCurveDrag();
		}
	});

	const handleTop = '-2px';
</script>

{#if isAudio || isVisual}
	<div
		bind:this={container}
		data-fade-handles={isAudio ? 'audio' : 'video'}
		data-clip-fade-controls={isAudio ? 'audio' : 'video'}
		class="pointer-events-none absolute inset-0"
		aria-hidden={canInteract ? undefined : 'true'}
	>
		<!-- Envelope paths: always visible, not density-controlled -->
		<svg
			class="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 {FADE_VIEWBOX_WIDTH} {FADE_VIEWBOX_HEIGHT}"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{#if isAudio}
				{#if audioFadeInCurvePath}
					<path d={audioFadeInCurvePath} fill="rgba(0,0,0,0.42)" data-fade-path="audio-in" />
				{/if}
				{#if audioFadeOutCurvePath}
					<path d={audioFadeOutCurvePath} fill="rgba(0,0,0,0.42)" data-fade-path="audio-out" />
				{/if}
			{:else if isVisual}
				{#if videoFadeInPath}
					<path d={videoFadeInPath} fill="rgba(15,23,42,0.46)" data-fade-path="video-in" />
				{/if}
				{#if videoFadeOutPath}
					<path d={videoFadeOutPath} fill="rgba(15,23,42,0.46)" data-fade-path="video-out" />
				{/if}
			{/if}
		</svg>

		<!-- Handles container: density-controlled -->
		<div
			class="pointer-events-none absolute inset-0 z-30 transition-opacity duration-150 {densityVisibilityClass}"
			data-fade-handles-container
		>
			<!-- Fade-in handle -->
			<button
				type="button"
				role="slider"
				class="absolute h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize touch-none rounded-[2px] border border-slate-950/70 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.25)] transition-opacity before:absolute before:-inset-[9px] before:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-t-[4px] after:border-r-[3px] after:border-l-[3px] after:border-t-white/90 after:border-r-transparent after:border-l-transparent focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {editing ===
					'in' || hovered === 'in'
					? 'opacity-100'
					: handleVisibilityClass} [@media(pointer:coarse)]:before:-inset-[17px]"
				style="left:{fadeInPercent}%; top:{handleTop}"
				aria-label={isAudio
					? m.video_editor_adjust_audio_fade_in()
					: m.video_editor_adjust_video_fade_in()}
				aria-valuemin={0}
				aria-valuemax={duration > 0 && fps > 0 ? duration / fps : 10}
				aria-valuenow={fadeIn}
				aria-valuetext={isAudio
					? m.video_editor_fade_in_readout({ seconds: fadeIn.toFixed(2) })
					: m.video_editor_fade_in_readout({ seconds: fadeIn.toFixed(2) })}
				title={keyboardHelp}
				data-fade-handle="in"
				data-fade-kind={isAudio ? 'audio' : 'video'}
				onpointerdown={(e) => startFadePointerDown(e, 'in')}
				onkeydown={(e) => adjustFadeWithKeyboard(e, 'in')}
				ondblclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					resetFade('in');
				}}
				onmouseenter={() => (hovered = 'in')}
				onmouseleave={() => {
					if (editing !== 'in' && curveEditing !== 'in')
						hovered = hovered === 'in' ? null : hovered;
				}}
				onfocus={() => (hovered = 'in')}
				onblur={() => {
					if (editing !== 'in' && curveEditing !== 'in')
						hovered = hovered === 'in' ? null : hovered;
				}}
			></button>
			<!-- Fade-out handle -->
			<button
				type="button"
				role="slider"
				class="absolute h-2.5 w-2.5 -translate-x-1/2 cursor-ew-resize touch-none rounded-[2px] border border-slate-950/70 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.25)] transition-opacity before:absolute before:-inset-[9px] before:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-t-[4px] after:border-r-[3px] after:border-l-[3px] after:border-t-white/90 after:border-r-transparent after:border-l-transparent focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {editing ===
					'out' || hovered === 'out'
					? 'opacity-100'
					: handleVisibilityClass} [@media(pointer:coarse)]:before:-inset-[17px]"
				style="left:{fadeOutLeft}%; top:{handleTop}"
				aria-label={isAudio
					? m.video_editor_adjust_audio_fade_out()
					: m.video_editor_adjust_video_fade_out()}
				aria-valuemin={0}
				aria-valuemax={duration > 0 && fps > 0 ? duration / fps : 10}
				aria-valuenow={fadeOut}
				aria-valuetext={isAudio
					? m.video_editor_fade_out_readout({ seconds: fadeOut.toFixed(2) })
					: m.video_editor_fade_out_readout({ seconds: fadeOut.toFixed(2) })}
				title={keyboardHelp}
				data-fade-handle="out"
				data-fade-kind={isAudio ? 'audio' : 'video'}
				onpointerdown={(e) => startFadePointerDown(e, 'out')}
				onkeydown={(e) => adjustFadeWithKeyboard(e, 'out')}
				ondblclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					resetFade('out');
				}}
				onmouseenter={() => (hovered = 'out')}
				onmouseleave={() => {
					if (editing !== 'out' && curveEditing !== 'out')
						hovered = hovered === 'out' ? null : hovered;
				}}
				onfocus={() => (hovered = 'out')}
				onblur={() => {
					if (editing !== 'out' && curveEditing !== 'out')
						hovered = hovered === 'out' ? null : hovered;
				}}
			></button>

			<!-- Audio curve dots -->
			{#if isAudio && audioFadeInCurvePoint}
				<button
					type="button"
					role="slider"
					class="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border border-orange-200/90 shadow-[0_0_0_1px_rgba(15,23,42,0.2)] transition-opacity before:absolute before:-inset-[8px] before:content-[''] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {curveEditing ===
						'in' || hovered === 'in'
						? 'bg-orange-500 opacity-100'
						: 'bg-orange-400/90 opacity-0 group-hover/timeline-item:opacity-100'} [@media(pointer:coarse)]:before:-inset-[17px]"
					style="left:{(audioFadeInCurvePoint.x / FADE_VIEWBOX_WIDTH) *
						100}%; top:{audioFadeInCurvePoint.y}%"
					aria-label={m.video_editor_adjust_audio_fade_in_curve()}
					aria-valuemin={-1}
					aria-valuemax={1}
					aria-valuenow={audioFadeInCurve}
					aria-valuetext={m.video_editor_audio_fade_curve_value({
						curve: audioFadeInCurve.toFixed(2),
						bias: audioFadeInCurveX.toFixed(2)
					})}
					title={m.video_editor_audio_fade_curve_value({
						curve: audioFadeInCurve.toFixed(2),
						bias: audioFadeInCurveX.toFixed(2)
					})}
					data-fade-curve-dot="in"
					data-fade-kind="audio"
					onpointerdown={(e) => startCurvePointerDown(e, 'in')}
					onkeydown={(e) => adjustCurveWithKeyboard(e, 'in')}
					ondblclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						resetCurve('in');
					}}
					onmouseenter={() => (hovered = 'in')}
					onmouseleave={() => {
						if (curveEditing !== 'in') hovered = hovered === 'in' ? null : hovered;
					}}
				></button>
			{/if}
			{#if isAudio && audioFadeOutCurvePoint}
				<button
					type="button"
					role="slider"
					class="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full border border-orange-200/90 shadow-[0_0_0_1px_rgba(15,23,42,0.2)] transition-opacity before:absolute before:-inset-[8px] before:content-[''] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {curveEditing ===
						'out' || hovered === 'out'
						? 'bg-orange-500 opacity-100'
						: 'bg-orange-400/90 opacity-0 group-hover/timeline-item:opacity-100'} [@media(pointer:coarse)]:before:-inset-[17px]"
					style="left:{(audioFadeOutCurvePoint.x / FADE_VIEWBOX_WIDTH) *
						100}%; top:{audioFadeOutCurvePoint.y}%"
					aria-label={m.video_editor_adjust_audio_fade_out_curve()}
					aria-valuemin={-1}
					aria-valuemax={1}
					aria-valuenow={audioFadeOutCurve}
					aria-valuetext={m.video_editor_audio_fade_curve_value({
						curve: audioFadeOutCurve.toFixed(2),
						bias: audioFadeOutCurveX.toFixed(2)
					})}
					title={m.video_editor_audio_fade_curve_value({
						curve: audioFadeOutCurve.toFixed(2),
						bias: audioFadeOutCurveX.toFixed(2)
					})}
					data-fade-curve-dot="out"
					data-fade-kind="audio"
					onpointerdown={(e) => startCurvePointerDown(e, 'out')}
					onkeydown={(e) => adjustCurveWithKeyboard(e, 'out')}
					ondblclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						resetCurve('out');
					}}
					onmouseenter={() => (hovered = 'out')}
					onmouseleave={() => {
						if (curveEditing !== 'out') hovered = hovered === 'out' ? null : hovered;
					}}
				></button>
			{/if}

			{#if hovered !== null}
				{@const active = editing ?? curveEditing ?? hovered}
				{#if active}
					<span
						class="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white shadow-lg"
						style="left:{active === 'in' ? fadeInPercent : fadeOutLeft}%"
						data-fade-readout={active}
					>
						{#if active === 'in'}
							{m.video_editor_fade_in_readout({ seconds: fadeIn.toFixed(2) })}
						{:else}
							{m.video_editor_fade_out_readout({ seconds: fadeOut.toFixed(2) })}
						{/if}
					</span>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	[data-fade-readout] {
		max-width: 90vw;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
