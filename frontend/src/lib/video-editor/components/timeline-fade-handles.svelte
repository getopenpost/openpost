<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		captureSnapshot,
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
	import TimelineFloatingReadout from './timeline-floating-readout.svelte';

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
	let fadeInHandle: HTMLButtonElement | null = $state.raw(null);
	let fadeOutHandle: HTMLButtonElement | null = $state.raw(null);
	let curveInHandle: HTMLButtonElement | null = $state.raw(null);
	let curveOutHandle: HTMLButtonElement | null = $state.raw(null);
	let hoveredFade: FadeHandle | null = $state(null);
	let hoveredCurve: FadeHandle | null = $state(null);
	let editing: FadeHandle | null = $state(null);
	let curveEditing: FadeHandle | null = $state(null);

	let fadeDrag: {
		handle: FadeHandle;
		pointerId: number;
		beforeSnapshot: ReturnType<typeof captureSnapshot>;
		beforeItem: TimelineItem;
		target: HTMLElement;
	} | null = $state.raw(null);

	let curveDrag: {
		handle: FadeHandle;
		pointerId: number;
		beforeSnapshot: ReturnType<typeof captureSnapshot>;
		beforeItem: TimelineItem;
		target: HTMLElement;
	} | null = $state.raw(null);

	const isAudio = $derived(supportsAudioFade(item));
	const isVisual = $derived(supportsVisualFade(item));
	const fps = $derived(timelineStore.fps);
	const liveItem = $derived(timelineStore.itemById.get(item.id) ?? item);
	const duration = $derived(liveItem.durationInFrames);

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
		isAnyEditing
			? 'opacity-100'
			: 'opacity-0 @min-[44px]:opacity-40 @min-[64px]:opacity-100 group-focus-within/timeline-item:opacity-100'
	);
	const densityPointerClass = $derived(
		isAnyEditing ? 'pointer-events-auto' : 'pointer-events-none @min-[44px]:pointer-events-auto'
	);

	const keyboardHelp = $derived(m.video_editor_fade_handle_keyboard());
	const curveKeyboardHelpId = $derived(
		`audio-fade-curve-help-${item.id.replace(/[^A-Za-z0-9_-]/g, '-')}`
	);
	const readoutCurve = $derived(curveEditing ?? hoveredCurve);
	const readoutFade = $derived(editing ?? hoveredFade);
	const readoutHandle = $derived.by(() => {
		if (readoutCurve === 'in') return curveInHandle;
		if (readoutCurve === 'out') return curveOutHandle;
		if (readoutFade === 'in') return fadeInHandle;
		if (readoutFade === 'out') return fadeOutHandle;
		return null;
	});
	const readoutText = $derived.by(() => {
		if (readoutCurve === 'in') {
			return m.video_editor_audio_fade_curve_value({
				curve: audioFadeInCurve.toFixed(2),
				bias: audioFadeInCurveX.toFixed(2)
			});
		}
		if (readoutCurve === 'out') {
			return m.video_editor_audio_fade_curve_value({
				curve: audioFadeOutCurve.toFixed(2),
				bias: audioFadeOutCurveX.toFixed(2)
			});
		}
		if (readoutFade === 'in') {
			return m.video_editor_fade_in_readout({ seconds: fadeIn.toFixed(2) });
		}
		if (readoutFade === 'out') {
			return m.video_editor_fade_out_readout({ seconds: fadeOut.toFixed(2) });
		}
		return '';
	});
	const readoutKey = $derived(
		`${readoutCurve ?? ''}:${readoutFade ?? ''}:${fadeIn}:${fadeOut}:${audioFadeInCurve}:${audioFadeOutCurve}:${audioFadeInCurveX}:${audioFadeOutCurveX}`
	);

	function commitFade(handle: FadeHandle, nextSeconds: number): void {
		const clamped = clampFadeSeconds(nextSeconds, duration, fps);
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
		return clampFadeSeconds(raw, duration, fps);
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

	function restoreFade(handle: FadeHandle, beforeItem: TimelineItem): void {
		const patch: Partial<TimelineItem> = {};
		if (isAudio) {
			if (handle === 'in') patch.audioFadeIn = beforeItem.audioFadeIn;
			else patch.audioFadeOut = beforeItem.audioFadeOut;
		} else if (isVisual) {
			if (handle === 'in') patch.fadeIn = beforeItem.fadeIn;
			else patch.fadeOut = beforeItem.fadeOut;
		}
		timelineStore._updateItems([{ id: item.id, patch }]);
	}

	function onFadePointerMove(event: PointerEvent): void {
		if (!fadeDrag || event.pointerId !== fadeDrag.pointerId) return;
		const next = computeFadeSeconds(event.clientX, fadeDrag.handle);
		commitFade(fadeDrag.handle, next);
	}

	function finishFadeDrag(cancelled: boolean): void {
		if (!fadeDrag) return;
		const before = fadeDrag.beforeSnapshot;
		const beforeItem = fadeDrag.beforeItem;
		const handle = fadeDrag.handle;
		cleanupFadeDrag();
		if (cancelled) {
			restoreFade(handle, beforeItem);
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
		const beforeItem = timelineStore.itemById.get(item.id);
		if (!beforeItem) return;
		fadeDrag = {
			handle,
			pointerId: event.pointerId,
			beforeSnapshot: before,
			beforeItem: { ...beforeItem },
			target
		};
		editing = handle;
		hoveredFade = handle;
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

	function restoreCurve(handle: FadeHandle, beforeItem: TimelineItem): void {
		const patch: Partial<TimelineItem> = {};
		if (handle === 'in') {
			patch.audioFadeInCurve = beforeItem.audioFadeInCurve;
			patch.audioFadeInCurveX = beforeItem.audioFadeInCurveX;
		} else {
			patch.audioFadeOutCurve = beforeItem.audioFadeOutCurve;
			patch.audioFadeOutCurveX = beforeItem.audioFadeOutCurveX;
		}
		timelineStore._updateItems([{ id: item.id, patch }]);
	}

	function onCurvePointerMove(event: PointerEvent): void {
		if (!curveDrag || event.pointerId !== curveDrag.pointerId) return;
		const next = computeCurve(event.clientX, event.clientY, curveDrag.handle);
		commitCurve(curveDrag.handle, next.curve, next.curveX);
	}

	function finishCurveDrag(cancelled: boolean): void {
		if (!curveDrag) return;
		const before = curveDrag.beforeSnapshot;
		const beforeItem = curveDrag.beforeItem;
		const handle = curveDrag.handle;
		cleanupCurveDrag();
		if (cancelled) {
			restoreCurve(handle, beforeItem);
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
		const beforeItem = timelineStore.itemById.get(item.id);
		if (!beforeItem) return;
		curveDrag = {
			handle,
			pointerId: event.pointerId,
			beforeSnapshot: before,
			beforeItem: { ...beforeItem },
			target
		};
		curveEditing = handle;
		hoveredCurve = handle;
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
			const max = duration > 0 && fps > 0 ? duration / fps : 5;
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

	function stopControlClick(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
	}

	$effect(() => {
		if (canInteract) return;
		if (fadeDrag) finishFadeDrag(true);
		if (curveDrag) finishCurveDrag(true);
	});

	onDestroy(() => {
		if (fadeDrag) {
			restoreFade(fadeDrag.handle, fadeDrag.beforeItem);
			cleanupFadeDrag();
		}
		if (curveDrag) {
			restoreCurve(curveDrag.handle, curveDrag.beforeItem);
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
	>
		{#if isAudio}
			<span class="sr-only" id={curveKeyboardHelpId}
				>{m.video_editor_audio_fade_curve_keyboard()}</span
			>
		{/if}
		<!-- Envelope paths: always visible, not density-controlled -->
		<svg
			class="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 {FADE_VIEWBOX_WIDTH} {FADE_VIEWBOX_HEIGHT}"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{#if isAudio}
				{#if audioFadeInCurvePath}
					<path d={audioFadeInCurvePath} fill="rgba(0,0,0,0.5)" data-fade-path="audio-in" />
				{/if}
				{#if audioFadeOutCurvePath}
					<path d={audioFadeOutCurvePath} fill="rgba(0,0,0,0.5)" data-fade-path="audio-out" />
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
				bind:this={fadeInHandle}
				type="button"
				role="slider"
				class="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-[2px] transition-opacity focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {editing ===
					'in' || hoveredFade === 'in'
					? 'opacity-100'
					: handleVisibilityClass}"
				style="left:{fadeInPercent}%; top:{handleTop}"
				disabled={!canInteract}
				aria-disabled={!canInteract}
				tabindex={canInteract ? 0 : -1}
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
				onclickcapture={stopControlClick}
				onpointerdown={(e) => startFadePointerDown(e, 'in')}
				onkeydown={(e) => adjustFadeWithKeyboard(e, 'in')}
				ondblclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					resetFade('in');
				}}
				onmouseenter={() => (hoveredFade = 'in')}
				onmouseleave={() => {
					if (editing !== 'in' && curveEditing !== 'in')
						hoveredFade = hoveredFade === 'in' ? null : hoveredFade;
				}}
				onfocus={() => (hoveredFade = 'in')}
				onblur={() => {
					if (editing !== 'in' && curveEditing !== 'in')
						hoveredFade = hoveredFade === 'in' ? null : hoveredFade;
				}}
			>
				<span
					class="pointer-events-none h-2.5 w-2.5 rounded-[2px] border border-slate-950/70 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.25)] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-t-[4px] after:border-r-[3px] after:border-l-[3px] after:border-t-white/90 after:border-r-transparent after:border-l-transparent"
					aria-hidden="true"
				></span>
			</button>
			<!-- Fade-out handle -->
			<button
				bind:this={fadeOutHandle}
				type="button"
				role="slider"
				class="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-[2px] transition-opacity focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {editing ===
					'out' || hoveredFade === 'out'
					? 'opacity-100'
					: handleVisibilityClass}"
				disabled={!canInteract}
				aria-disabled={!canInteract}
				tabindex={canInteract ? 0 : -1}
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
				onclickcapture={stopControlClick}
				onpointerdown={(e) => startFadePointerDown(e, 'out')}
				onkeydown={(e) => adjustFadeWithKeyboard(e, 'out')}
				ondblclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					resetFade('out');
				}}
				onmouseenter={() => (hoveredFade = 'out')}
				onmouseleave={() => {
					if (editing !== 'out' && curveEditing !== 'out')
						hoveredFade = hoveredFade === 'out' ? null : hoveredFade;
				}}
				onfocus={() => (hoveredFade = 'out')}
				onblur={() => {
					if (editing !== 'out' && curveEditing !== 'out')
						hoveredFade = hoveredFade === 'out' ? null : hoveredFade;
				}}
			>
				<span
					class="pointer-events-none h-2.5 w-2.5 rounded-[2px] border border-slate-950/70 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.25)] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-t-[4px] after:border-r-[3px] after:border-l-[3px] after:border-t-white/90 after:border-r-transparent after:border-l-transparent"
					aria-hidden="true"
				></span>
			</button>

			<!-- Audio curve dots -->
			{#if isAudio && audioFadeInCurvePoint}
				<button
					bind:this={curveInHandle}
					type="button"
					role="slider"
					class="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none items-center justify-center rounded-full transition-opacity focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {curveEditing ===
						'in' || hoveredCurve === 'in'
						? 'opacity-100'
						: 'opacity-0 group-hover/timeline-item:opacity-100'}"
					style="left:{(audioFadeInCurvePoint.x / FADE_VIEWBOX_WIDTH) *
						100}%; top:{audioFadeInCurvePoint.y}%"
					aria-label={m.video_editor_adjust_audio_fade_in_curve()}
					aria-describedby={curveKeyboardHelpId}
					disabled={!canInteract}
					aria-disabled={!canInteract}
					tabindex={canInteract ? 0 : -1}
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
					onclickcapture={stopControlClick}
					onpointerdown={(e) => startCurvePointerDown(e, 'in')}
					onkeydown={(e) => adjustCurveWithKeyboard(e, 'in')}
					ondblclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						resetCurve('in');
					}}
					onmouseenter={() => (hoveredCurve = 'in')}
					onmouseleave={() => {
						if (curveEditing !== 'in') hoveredCurve = hoveredCurve === 'in' ? null : hoveredCurve;
					}}
					onfocus={() => (hoveredCurve = 'in')}
					onblur={() => {
						if (curveEditing !== 'in') hoveredCurve = hoveredCurve === 'in' ? null : hoveredCurve;
					}}
				>
					<span
						class="pointer-events-none h-2.5 w-2.5 rounded-full border border-orange-200/90 shadow-[0_0_0_1px_rgba(15,23,42,0.2)] {curveEditing ===
							'in' || hoveredCurve === 'in'
							? 'bg-orange-500'
							: 'bg-orange-400/90'}"
						aria-hidden="true"
					></span>
				</button>
			{/if}
			{#if isAudio && audioFadeOutCurvePoint}
				<button
					bind:this={curveOutHandle}
					type="button"
					role="slider"
					class="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none items-center justify-center rounded-full transition-opacity focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none {densityPointerClass} {curveEditing ===
						'out' || hoveredCurve === 'out'
						? 'opacity-100'
						: 'opacity-0 group-hover/timeline-item:opacity-100'}"
					style="left:{(audioFadeOutCurvePoint.x / FADE_VIEWBOX_WIDTH) *
						100}%; top:{audioFadeOutCurvePoint.y}%"
					aria-label={m.video_editor_adjust_audio_fade_out_curve()}
					aria-describedby={curveKeyboardHelpId}
					disabled={!canInteract}
					aria-disabled={!canInteract}
					tabindex={canInteract ? 0 : -1}
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
					onclickcapture={stopControlClick}
					onpointerdown={(e) => startCurvePointerDown(e, 'out')}
					onkeydown={(e) => adjustCurveWithKeyboard(e, 'out')}
					ondblclick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						resetCurve('out');
					}}
					onmouseenter={() => (hoveredCurve = 'out')}
					onmouseleave={() => {
						if (curveEditing !== 'out') hoveredCurve = hoveredCurve === 'out' ? null : hoveredCurve;
					}}
					onfocus={() => (hoveredCurve = 'out')}
					onblur={() => {
						if (curveEditing !== 'out') hoveredCurve = hoveredCurve === 'out' ? null : hoveredCurve;
					}}
				>
					<span
						class="pointer-events-none h-2.5 w-2.5 rounded-full border border-orange-200/90 shadow-[0_0_0_1px_rgba(15,23,42,0.2)] {curveEditing ===
							'out' || hoveredCurve === 'out'
							? 'bg-orange-500'
							: 'bg-orange-400/90'}"
						aria-hidden="true"
					></span>
				</button>
			{/if}

			<TimelineFloatingReadout
				anchor={readoutHandle}
				text={readoutText}
				measureKey={readoutKey}
				kind={readoutCurve ?? readoutFade}
			/>
		</div>
	</div>
{/if}
