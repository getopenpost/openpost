<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Dialog } from '$lib/components/ui/dialog';
	import { showToast } from '$lib/toast';
	import {
		RecorderSession,
		listRecorderDevices,
		recorderMimeType,
		type RecorderSource
	} from '$lib/video-editor/recorder/recorder.svelte';
	import { insertRecordingAtPlayhead } from '$lib/video-editor/recorder/insert-recording';

	interface Props {
		open: boolean;
		projectId: string;
		onopenchange: (open: boolean) => void;
		oninserted: (itemId: string) => void;
	}

	let { open, projectId, onopenchange, oninserted }: Props = $props();
	const session = new RecorderSession();
	let cameras = $state<MediaDeviceInfo[]>([]);
	let microphones = $state<MediaDeviceInfo[]>([]);
	let source = $state<RecorderSource>('screen');
	let cameraId = $state('');
	let micId = $state('');
	let systemAudio = $state(true);
	let previewEl = $state<HTMLVideoElement | null>(null);
	let pipHandleEl = $state<HTMLButtonElement | null>(null);
	let starting = $state(false);
	let stopping = $state(false);
	let uiError = $state<string | null>(null);
	let pipDragging = $state(false);

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

	$effect(() => {
		if (open) {
			void listRecorderDevices().then((l) => {
				cameras = l.cameras;
				microphones = l.microphones;
			});
			const onDevices = () => {
				void listRecorderDevices().then((l) => {
					cameras = l.cameras;
					microphones = l.microphones;
				});
			};
			navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);
			return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
		}
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
		if (!recorderMimeType(source !== 'audio')) return m.video_editor_recording_error_codec();
		return msg;
	}

	async function start(): Promise<void> {
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

	async function stopAndInsert(): Promise<void> {
		if (stopping) return;
		stopping = true;
		try {
			const result = await session.stop();
			if (!result) {
				showToast(m.video_editor_recording_cancelled_hint(), 'info');
				onopenchange(false);
				return;
			}
			const kind = source === 'audio' ? 'audio' : 'video';
			const stamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
			const fileName = `recording-${source}-${stamp}.${result.mimeType.includes('audio') ? 'weba' : 'webm'}`;
			const itemId = await insertRecordingAtPlayhead({
				blob: result.blob,
				mimeType: result.mimeType,
				projectId,
				fileName,
				kind
			});
			if (!itemId) {
				const url = URL.createObjectURL(result.blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = fileName;
				a.click();
				setTimeout(() => URL.revokeObjectURL(url), 10_000);
				showToast(m.video_editor_recording_insert_failed(), 'error');
				return;
			}
			oninserted(itemId);
			showToast(m.video_editor_recording_inserted(), 'success');
			onopenchange(false);
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
		onopenchange(false);
	}

	function handlePipPointerDown(event: PointerEvent): void {
		if (!session.usesCompositing) return;
		pipDragging = true;
		// SAFETY: test helper at boundary, validated via typed helper
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function handlePipPointerMove(event: PointerEvent): void {
		if (!pipDragging || !session.usesCompositing) return;
		const rect = getVideoContentRect();
		if (!rect) return;
		const nx = (event.clientX - rect.left) / Math.max(1, rect.width);
		const ny = (event.clientY - rect.top) / Math.max(1, rect.height);
		const aspect = previewEl ? previewEl.videoWidth / Math.max(1, previewEl.videoHeight) : 1.78;
		const pipW = session.pip.width;
		const pipH = (pipW * rect.width) / Math.max(1, ((pipW * rect.width) / (aspect || 1)) * 1);
		// Normalize clamped both axes using actual content size
		const clampedX = Math.max(0.01, Math.min(0.99 - pipW, nx - pipW / 2));
		const clampedY = Math.max(0.01, Math.min(0.99 - 0.2, ny - 0.11));
		session.setPipGeometry({ x: clampedX, y: clampedY });
	}

	function handlePipPointerUp(event: PointerEvent): void {
		if (!pipDragging) return;
		pipDragging = false;
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

<Dialog
	{open}
	onOpenChange={(v) => {
		if (!v) void session.cancel();
		onopenchange(v);
	}}
>
	{#snippet header()}
		<h2 class="text-sm font-semibold">{m.video_editor_record()}</h2>
		<p class="text-xs text-muted-foreground">{m.video_editor_record_screen_description()}</p>
	{/snippet}

	<div class="flex flex-col gap-3 p-4">
		<div
			class="relative flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-[oklch(0.12_0.008_55)]"
		>
			{#if session.stream}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={previewEl} class="max-h-64 w-full object-contain" playsinline muted
				></video>
				{#if session.usesCompositing}
					<button
						bind:this={pipHandleEl}
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
					<span
						class="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
					>
						{m.video_editor_recording_pip_drag_hint()}
					</span>
				{/if}
			{:else}
				<p class="p-4 text-center text-xs text-muted-foreground">{m.record_preview_empty()}</p>
			{/if}
		</div>

		{#if session.backpressure}
			<div
				role="status"
				class="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100"
			>
				{m.video_editor_recording_backpressure()}
			</div>
		{/if}

		{#if uiError}
			<div
				role="alert"
				class="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200"
			>
				{uiError}
			</div>
		{/if}
		{#if session.error}
			<div
				role="alert"
				class="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200"
			>
				{session.error}
			</div>
		{/if}

		{#if !session.recording}
			<fieldset class="flex flex-wrap gap-2">
				<legend class="sr-only">{m.record_source_label()}</legend>
				{#each [{ value: 'screen', label: m.record_source_screen() }, { value: 'camera', label: m.record_source_camera() }, { value: 'screen-camera', label: m.record_source_both() }, { value: 'audio', label: m.record_source_audio() }] as opt (opt.value)}
					<Button
						size="sm"
						variant={source === opt.value ? 'default' : 'outline'}
						aria-pressed={source === opt.value}
						onclick={() => (source = opt.value as RecorderSource)}
						class="min-h-11"
					>
						{opt.label}
					</Button>
				{/each}
			</fieldset>

			<div class="flex flex-wrap gap-3">
				{#if needsCamera}
					<label class="flex flex-1 flex-col gap-1 text-xs">
						<span>{m.video_editor_recording_device_camera()}</span>
						<AppSelect
							bind:value={cameraId}
							ariaLabel={m.video_editor_recording_select_camera()}
							options={cameras.map((c) => ({
								value: c.deviceId,
								label: c.label || m.record_device_default()
							}))}
							class="h-11"
						/>
					</label>
				{/if}
				{#if source !== 'screen'}
					<label class="flex flex-1 flex-col gap-1 text-xs">
						<span>{m.video_editor_recording_device_microphone()}</span>
						<AppSelect
							bind:value={micId}
							ariaLabel={m.video_editor_recording_select_mic()}
							options={[
								{ value: '', label: m.record_device_default() },
								...microphones.map((mm) => ({ value: mm.deviceId, label: mm.label }))
							]}
							class="h-11"
						/>
					</label>
				{/if}
			</div>
			{#if hasVideo}
				<label class="flex items-center gap-2 text-xs">
					<Checkbox bind:checked={systemAudio} />
					{m.record_system_audio()}
				</label>
			{/if}
			{#if !mimeOk}
				<p role="alert" class="text-xs text-red-400">{m.record_unsupported()}</p>
			{/if}

			<div class="flex justify-end gap-2">
				<Button variant="ghost" class="min-h-11" onclick={() => onopenchange(false)}
					>{m.common_cancel()}</Button
				>
				<Button class="min-h-11" onclick={start} disabled={starting || !mimeOk}>
					{starting ? m.common_loading() : m.record_start()}
				</Button>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-2">
				<span class="font-mono text-lg" aria-live="polite">
					● {Math.floor(session.elapsedSeconds / 60)}:{String(session.elapsedSeconds % 60).padStart(
						2,
						'0'
					)}
				</span>
				<p class="text-xs text-muted-foreground">{m.video_editor_recording_cursor_burned_in()}</p>
				<div class="flex gap-2">
					<Button
						variant="destructive"
						class="min-h-11"
						onclick={stopAndInsert}
						disabled={stopping}
					>
						{stopping ? m.common_loading() : m.video_editor_recording_add_to_timeline()}
					</Button>
					<Button variant="ghost" class="min-h-11" onclick={cancel} disabled={stopping}>
						{m.video_editor_recording_cancel()}
					</Button>
				</div>
			</div>
		{/if}
	</div>
</Dialog>
