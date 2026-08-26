<!--
Record: screen, camera, microphone, or combined capture saved locally.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import {
		RecorderSession,
		listRecorderDevices,
		recorderMimeType,
		type RecorderSource
	} from '$lib/video-editor/recorder/recorder.svelte';
	import { listRecoverableSessions } from '$lib/video-editor/recorder/recording-sessions';

	const session = new RecorderSession();
	let cameras = $state<MediaDeviceInfo[]>([]);
	let microphones = $state<MediaDeviceInfo[]>([]);
	let source = $state<RecorderSource>('screen');
	let cameraId = $state('');
	let micId = $state('');
	let systemAudio = $state(true);
	let previewEl = $state<HTMLVideoElement | null>(null);
	let previewWrap = $state<HTMLDivElement | null>(null);
	let lastResult = $state<{ url: string; fileName: string; size: number } | null>(null);
	let starting = $state(false);
	let stopping = $state(false);
	let uiError = $state<string | null>(null);
	let recoverCount = $state(0);
	let pipDrag = $state(false);

	onMount(() => {
		void listRecorderDevices().then((lists) => {
			cameras = lists.cameras;
			microphones = lists.microphones;
		});
		void listRecoverableSessions()
			.then((list) => (recoverCount = list.length))
			.catch(() => undefined);
		const onDevices = () =>
			void listRecorderDevices().then((l) => {
				cameras = l.cameras;
				microphones = l.microphones;
			});
		navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);
		return () => {
			navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
			void session.cancel();
			if (lastResult) URL.revokeObjectURL(lastResult.url);
		};
	});

	$effect(() => {
		if (previewEl && session.stream) {
			previewEl.srcObject = session.stream;
			void previewEl.play().catch(() => undefined);
		}
	});

	function mapError(err: unknown): string {
		if (err instanceof DOMException) {
			if (err.name === 'NotAllowedError') return m.video_editor_recording_error_permission();
			if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')
				return m.video_editor_recording_error_no_device();
			if (err.name === 'NotReadableError' || err.name === 'AbortError')
				return m.video_editor_recording_error_busy();
		}
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('Canvas unavailable')) return m.video_editor_recording_error_canvas();
		if (msg.toLowerCase().includes('not supported') || !recorderMimeType(source !== 'audio'))
			return m.video_editor_recording_error_codec();
		return msg || m.video_editor_recording_error_busy();
	}

	async function start(): Promise<void> {
		lastResult = null;
		uiError = null;
		starting = true;
		try {
			await session.start(source, { cameraId, micId, systemAudio });
		} catch (err) {
			const msg = mapError(err);
			uiError = msg;
			showToast(msg, 'error');
		} finally {
			starting = false;
		}
	}

	async function stopAndSave(): Promise<void> {
		if (stopping) return;
		stopping = true;
		try {
			const result = await session.stop();
			if (!result) {
				showToast(m.video_editor_recording_cancelled_hint(), 'info');
				return;
			}
			const extension = result.mimeType.includes('audio') ? 'weba' : 'webm';
			const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
			const fileName = `recording-${source}-${stamp}.${extension}`;
			const url = URL.createObjectURL(result.blob);
			if (lastResult) URL.revokeObjectURL(lastResult.url);
			lastResult = { url, fileName, size: result.blob.size };
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = fileName;
			anchor.click();
			showToast(m.video_editor_recording_saved_label(), 'success');
			if (result.sessionId === undefined) {
				// No session, still show cursor fallback hint for screen
				if (source === 'screen' || source === 'screen-camera') {
					showToast(m.video_editor_recording_cursor_burned_in(), 'info');
				}
			}
		} catch (err) {
			showToast(mapError(err), 'error');
		} finally {
			stopping = false;
		}
	}

	async function cancel(): Promise<void> {
		await session.cancel();
		uiError = null;
		showToast(m.video_editor_recording_cancelled_hint(), 'info');
	}

	function getVideoContentRect(): DOMRect | null {
		if (!previewEl) return null;
		const wrapRect = previewEl.getBoundingClientRect();
		const vw = previewEl.videoWidth || 1280;
		const vh = previewEl.videoHeight || 720;
		const wrapAspect = wrapRect.width / Math.max(1, wrapRect.height);
		const videoAspect = vw / Math.max(1, vh);
		let contentWidth = wrapRect.width;
		let contentHeight = wrapRect.height;
		let offsetX = 0;
		let offsetY = 0;
		if (videoAspect > wrapAspect) {
			contentHeight = wrapRect.width / videoAspect;
			offsetY = (wrapRect.height - contentHeight) / 2;
		} else {
			contentWidth = wrapRect.height * videoAspect;
			offsetX = (wrapRect.width - contentWidth) / 2;
		}
		return new DOMRect(
			wrapRect.left + offsetX,
			wrapRect.top + offsetY,
			contentWidth,
			contentHeight
		);
	}

	function handlePipPointerDown(event: PointerEvent): void {
		if (!session.usesCompositing) return;
		pipDrag = true;
		// SAFETY: test helper at boundary, validated via typed helper
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handlePipPointerMove(event: PointerEvent): void {
		if (!pipDrag || !session.usesCompositing) return;
		const rect = getVideoContentRect();
		if (!rect) return;
		const nx = (event.clientX - rect.left) / Math.max(1, rect.width);
		const ny = (event.clientY - rect.top) / Math.max(1, rect.height);
		const pipW = session.pip.width;
		const clampedX = Math.max(0.01, Math.min(0.99 - pipW, nx - pipW / 2));
		const clampedY = Math.max(0.01, Math.min(0.99 - 0.2, ny - 0.11));
		session.setPipGeometry({ x: clampedX, y: clampedY });
	}

	function handlePipPointerUp(event: PointerEvent): void {
		if (!pipDrag) return;
		pipDrag = false;
		try {
			// SAFETY: test helper at boundary, validated via typed helper
			(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
		} catch {
			// Already released
		}
	}

	function handlePipKey(event: KeyboardEvent): void {
		if (!session.usesCompositing) return;
		const step = event.shiftKey ? 0.05 : 0.02;
		let dx = 0;
		let dy = 0;
		if (event.key === 'ArrowLeft') dx = -step;
		else if (event.key === 'ArrowRight') dx = step;
		else if (event.key === 'ArrowUp') dy = -step;
		else if (event.key === 'ArrowDown') dy = step;
		else return;
		event.preventDefault();
		session.setPipGeometry({ x: session.pip.x + dx, y: session.pip.y + dy });
	}

	const needsCamera = $derived(source === 'camera' || source === 'screen-camera');
	const hasVideo = $derived(source !== 'audio');
	const mimeOk = $derived(Boolean(recorderMimeType(hasVideo)));
</script>

<svelte:head>
	<title>{m.record_title()}</title>
</svelte:head>

<div class="flex min-h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]">
	<header
		class="flex items-center justify-between border-b border-[oklch(0.25_0.015_55)] px-3 py-2"
	>
		<a
			href="/editors"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.record_title()}</span>
		</a>
	</header>

	<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
		{#if recoverCount > 0}
			<div
				role="status"
				aria-live="polite"
				class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
			>
				<p class="font-medium text-amber-100">{m.video_editor_recording_recover_title()}</p>
				<p class="text-xs text-amber-100/80">{m.video_editor_recording_recover_description()}</p>
				<p class="mt-1 text-xs text-amber-100/80">
					<a
						href="/video-editor"
						class="underline focus-visible:outline-2 focus-visible:outline-amber-300"
					>
						{m.video_editor_recover_recording()}
					</a>
				</p>
			</div>
		{/if}

		<section
			bind:this={previewWrap}
			class="relative flex min-h-56 items-center justify-center overflow-hidden rounded-xl border border-dashed border-[oklch(0.3_0.01_55)] bg-[oklch(0.12_0.008_55)]"
			aria-label={m.record_preview_empty()}
		>
			{#if session.stream}
				<!-- svelte-ignore a11y_media_has_caption -- local recorder preview -->
				<video
					bind:this={previewEl}
					class="max-h-[50dvh] w-full rounded-lg object-contain"
					playsinline
					muted
				></video>
				{#if session.usesCompositing}
					<button
						type="button"
						aria-label={m.video_editor_recording_pip_label()}
						class="absolute flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-black/60 text-white focus-visible:outline-2 focus-visible:outline-white"
						style="left: calc({session.pip.x * 100}% - 16px); top: calc({session.pip.y *
							100}% - 16px);"
						onpointerdown={handlePipPointerDown}
						onpointermove={handlePipPointerMove}
						onpointerup={handlePipPointerUp}
						onkeydown={handlePipKey}
					>
						<span aria-hidden="true">⋮</span>
					</button>
				{/if}
			{:else if lastResult}
				<div class="p-6 text-center text-sm text-[oklch(0.65_0.015_55)]">
					<p>{m.record_done({ name: lastResult.fileName })}</p>
					<a
						class="mt-2 inline-block underline focus-visible:outline-2 focus-visible:outline-white"
						href={lastResult.url}
						download={lastResult.fileName}
					>
						{m.record_download_again()}
					</a>
					<div class="mt-3 flex flex-wrap justify-center gap-2">
						<Button
							size="sm"
							variant="outline"
							href={lastResult.url}
							download={lastResult.fileName}
						>
							{m.video_editor_recording_download()}
						</Button>
					</div>
				</div>
			{:else}
				<p class="text-center text-sm text-[oklch(0.65_0.015_55)]">{m.record_preview_empty()}</p>
			{/if}
		</section>

		{#if uiError}
			<div
				role="alert"
				class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
			>
				{uiError}
			</div>
		{/if}

		{#if session.error}
			<div
				role="alert"
				class="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
			>
				{session.error}
			</div>
		{/if}

		{#if !session.recording}
			<fieldset class="flex flex-wrap items-center justify-center gap-2">
				<legend class="sr-only">{m.record_source_label()}</legend>
				{#each [{ value: 'screen', label: m.record_source_screen() }, { value: 'camera', label: m.record_source_camera() }, { value: 'screen-camera', label: m.record_source_both() }, { value: 'audio', label: m.record_source_audio() }] as option (option.value)}
					<Button
						size="sm"
						variant={source === option.value ? 'default' : 'outline'}
						aria-pressed={source === option.value}
						onclick={() => (source = option.value as RecorderSource)}
						class="min-h-11"
					>
						{option.label}
					</Button>
				{/each}
			</fieldset>

			<div class="flex flex-wrap items-center justify-center gap-3 text-sm">
				{#if needsCamera}
					<label class="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
						<span class="text-xs sm:text-sm">{m.video_editor_recording_device_camera()}</span>
						<AppSelect
							bind:value={cameraId}
							ariaLabel={m.video_editor_recording_select_camera()}
							options={cameras.map((camera) => ({
								value: camera.deviceId,
								label: camera.label || m.record_device_default()
							}))}
							class="h-11 min-w-40"
						/>
					</label>
				{/if}
				{#if source !== 'screen'}
					<label class="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
						<span class="text-xs sm:text-sm">{m.video_editor_recording_device_microphone()}</span>
						<AppSelect
							bind:value={micId}
							ariaLabel={m.video_editor_recording_select_mic()}
							options={[
								{ value: '', label: m.record_device_default() },
								...microphones.map((microphone) => ({
									value: microphone.deviceId,
									label: microphone.label
								}))
							]}
							class="h-11 min-w-40"
						/>
					</label>
				{/if}
				{#if hasVideo}
					<label class="flex items-center gap-1.5 text-sm">
						<Checkbox bind:checked={systemAudio} />
						{m.record_system_audio()}
					</label>
				{/if}
			</div>

			{#if source === 'screen-camera'}
				<p class="text-center text-xs text-[oklch(0.65_0.015_55)]">
					{m.video_editor_recording_pip_drag_hint()}
				</p>
			{/if}

			<Button class="mx-auto min-h-11 min-w-36" onclick={start} disabled={starting || !mimeOk}>
				{starting ? m.common_loading() : m.record_start()}
			</Button>
		{:else}
			<div class="flex flex-col items-center gap-2">
				<span class="font-mono text-lg tabular-nums" aria-live="polite">
					● {Math.floor(session.elapsedSeconds / 60)}:{String(session.elapsedSeconds % 60).padStart(
						2,
						'0'
					)}
				</span>
				<div class="flex flex-wrap justify-center gap-2">
					<Button variant="destructive" class="min-h-11" onclick={stopAndSave} disabled={stopping}>
						{stopping ? m.common_loading() : m.record_stop_save()}
					</Button>
					<Button variant="ghost" class="min-h-11" onclick={cancel} disabled={stopping}>
						{m.video_editor_recording_cancel()}
					</Button>
				</div>
				{#if session.backpressure}
					<div
						role="status"
						class="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100"
					>
						{m.video_editor_recording_backpressure()}
					</div>
				{/if}
				<p class="text-xs text-[oklch(0.65_0.015_55)]">
					{m.video_editor_recording_cursor_burned_in()}
				</p>
			</div>
		{/if}

		{#if !mimeOk}
			<p role="alert" class="text-center text-xs text-red-400">{m.record_unsupported()}</p>
		{/if}
	</main>
</div>
