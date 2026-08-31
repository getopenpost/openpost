<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import {
		ScreenCaptureRecorder,
		listRecorderDevices,
		formatBytes,
		estimateBytesPerMinute,
		type RecorderKind
	} from '$lib/video-editor/recorder/recorder.svelte';
	import { recorderPreferences } from '$lib/video-editor/recorder/recorder-preferences.svelte';

	const recorder = new ScreenCaptureRecorder();
	const savedPreferences = untrack(() => recorderPreferences.value);
	let cameras = $state<MediaDeviceInfo[]>([]);
	let microphones = $state<MediaDeviceInfo[]>([]);
	let includeScreen = $state(savedPreferences.includeScreen);
	let includeCamera = $state(savedPreferences.includeCamera);
	let includeMic = $state(savedPreferences.includeMicrophone);
	let includeSystemAudio = $state(savedPreferences.includeSystemAudio);
	let cameraId = $state(savedPreferences.cameraDeviceId);
	let micId = $state(savedPreferences.microphoneDeviceId);
	let countdown = $state(String(savedPreferences.countdownSeconds));
	let plannedMinutes = $state(String(savedPreferences.plannedMinutes));
	let videoResolution = $state(savedPreferences.videoResolution);
	let videoFrameRate = $state(String(savedPreferences.videoFrameRate));
	let cameraFacingMode = $state(savedPreferences.cameraFacingMode);
	let noiseSuppression = $state(savedPreferences.noiseSuppression);
	let autoGainControl = $state(savedPreferences.autoGainControl);
	let screenPreviewEl = $state<HTMLVideoElement | null>(null);
	let cameraPreviewEl = $state<HTMLVideoElement | null>(null);
	let lastDownloads = $state<
		Array<{ url: string; name: string; kind: RecorderKind; size: number; scratchId?: string }>
	>([]);
	const hasRecoverableDownloads = $derived(
		lastDownloads.some((download) => download.scratchId !== undefined)
	);

	const hasSelection = $derived(includeScreen || includeCamera || includeMic);
	const micMeterWidth = $derived(Math.round(recorder.micLevel * 100));
	const elapsed = $derived.by(() => {
		const secs = Math.floor(recorder.elapsedMs / 1000);
		return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
	});

	function localizedRecorderError(): string {
		switch (recorder.error) {
			case 'permission-denied':
				return m.video_editor_recording_error_permission();
			case 'no-device':
				return m.video_editor_recording_error_device_missing();
			case 'device-busy':
				return m.video_editor_recording_error_device_busy();
			case 'storage-full':
				return m.video_editor_recording_storage_stopped();
			case 'unsupported':
				return m.video_editor_recording_error_unsupported();
			case 'stop-timeout':
				return m.video_editor_recording_error_stop_timeout();
			default:
				return m.video_editor_recording_error_start();
		}
	}

	function sourceLabel(kind: RecorderKind): string {
		if (kind === 'screen') return m.record_source_screen();
		if (kind === 'camera') return m.record_source_camera();
		return m.record_source_audio();
	}

	function selectedFrameRate(): 24 | 30 | 60 {
		if (videoFrameRate === '24') return 24;
		if (videoFrameRate === '60') return 60;
		return 30;
	}

	function setVideoResolution(value: string): void {
		if (value !== '720p' && value !== '1080p' && value !== '2160p') return;
		videoResolution = value;
		recorderPreferences.set('videoResolution', value);
	}

	function setCameraFacingMode(value: string): void {
		if (value !== 'default' && value !== 'user' && value !== 'environment') return;
		cameraFacingMode = value;
		recorderPreferences.set('cameraFacingMode', value);
	}

	async function refreshDevices(): Promise<void> {
		try {
			const lists = await listRecorderDevices();
			cameras = lists.cameras;
			microphones = lists.microphones;
			if (cameraId && !cameras.some((device) => device.deviceId === cameraId)) {
				cameraId = '';
				recorderPreferences.set('cameraDeviceId', '');
			}
			if (micId && !microphones.some((device) => device.deviceId === micId)) {
				micId = '';
				recorderPreferences.set('microphoneDeviceId', '');
			}
		} catch {
			cameras = [];
			microphones = [];
		}
	}

	onMount(() => {
		let mounted = true;
		void refreshDevices();
		void recorder
			.loadRecoverableArtifacts()
			.then((artifacts) => {
				if (!mounted) return;
				lastDownloads = artifacts.map((artifact) => ({
					url: URL.createObjectURL(artifact.blob),
					name: `recording-${artifact.kind}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.webm`,
					kind: artifact.kind,
					size: artifact.sizeBytes,
					scratchId: artifact.scratchId
				}));
			})
			.catch(() => undefined);
		const handler = () => void refreshDevices();
		navigator.mediaDevices?.addEventListener?.('devicechange', handler);
		return () => {
			mounted = false;
			navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
			queueMicrotask(() => void recorder.cancel());
			for (const d of lastDownloads) URL.revokeObjectURL(d.url);
		};
	});

	$effect(() => {
		if (screenPreviewEl && recorder.screenStream) {
			screenPreviewEl.srcObject = recorder.screenStream;
			void screenPreviewEl.play().catch(() => undefined);
		}
	});
	$effect(() => {
		if (cameraPreviewEl && recorder.cameraStream) {
			cameraPreviewEl.srcObject = recorder.cameraStream;
			void cameraPreviewEl.play().catch(() => undefined);
		}
	});

	async function handleStart(): Promise<void> {
		if (!hasSelection) {
			showToast(m.video_editor_recording_select_source(), 'error');
			return;
		}
		try {
			await recorder.startWithSelection(
				{
					screen: includeScreen,
					camera: includeCamera,
					microphone: includeMic
				},
				{
					cameraDeviceId: cameraId || null,
					microphoneDeviceId: micId || null,
					includeSystemAudio,
					countdownSeconds: Number(countdown) || 0,
					videoResolution,
					videoFrameRate: selectedFrameRate(),
					cameraFacingMode,
					noiseSuppression,
					autoGainControl
				}
			);
		} catch {
			showToast(localizedRecorderError(), 'error');
		}
	}

	async function handleStop(): Promise<void> {
		try {
			const artifacts = await recorder.stop();
			if (artifacts.length === 0) {
				showToast(m.video_editor_recording_cancelled(), 'info');
				return;
			}
			const downloads = artifacts.map((a) => {
				const ext = a.mimeType.includes('ogg') ? 'ogg' : 'webm';
				const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
				const name = `recording-${a.kind}-${stamp}.${ext}`;
				const url = URL.createObjectURL(a.blob);
				// Auto-download each artifact
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = name;
				anchor.click();
				return { url, name, kind: a.kind, size: a.blob.size };
			});
			lastDownloads = [...lastDownloads, ...downloads];
			await recorder.discardArtifacts(artifacts);
			showToast(m.record_saved(), 'success');
		} catch {
			showToast(localizedRecorderError(), 'error');
		}
	}

	async function handleCancel(): Promise<void> {
		await recorder.cancel();
		showToast(m.record_discarded(), 'info');
	}

	async function handleDiscardRecovery(): Promise<void> {
		await recorder.clearRecoverableAndDiscard();
		for (const download of lastDownloads) {
			if (download.scratchId) URL.revokeObjectURL(download.url);
		}
		lastDownloads = lastDownloads.filter((download) => !download.scratchId);
	}

	const isRequesting = $derived(recorder.status === 'requesting');
	const isCountdown = $derived(recorder.status === 'countdown');
	const isStopping = $derived(recorder.status === 'stopping');
	const captureBusy = $derived(
		recorder.status === 'recording' || isCountdown || isRequesting || isStopping
	);
	const perMin = $derived(
		estimateBytesPerMinute(
			{
				screen: includeScreen,
				camera: includeCamera,
				microphone: includeMic
			},
			{
				videoResolution,
				videoFrameRate: selectedFrameRate(),
				includeSystemAudio
			}
		)
	);
	const plannedEstimate = $derived(
		formatBytes(Math.ceil(perMin * (Number(plannedMinutes) || 5) * 1.2))
	);
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
		<!-- Preview -->
		<section
			class="relative flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[oklch(0.3_0.01_55)] bg-[oklch(0.12_0.008_55)] p-3"
			aria-label={m.record_preview_empty()}
		>
			{#if recorder.screenStream || recorder.cameraStream}
				<div class="grid w-full gap-3 sm:grid-cols-2">
					{#if recorder.screenStream}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							bind:this={screenPreviewEl}
							class="max-h-[40dvh] w-full rounded-lg object-contain"
							playsinline
							muted
						></video>
					{/if}
					{#if recorder.cameraStream}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							bind:this={cameraPreviewEl}
							class="max-h-[40dvh] w-full rounded-lg object-contain"
							playsinline
							muted
						></video>
					{/if}
				</div>
				{#if recorder.status === 'recording'}
					<span class="font-mono text-lg tabular-nums" aria-live="polite">● {elapsed}</span>
				{/if}
			{:else if lastDownloads.length > 0}
				<div class="p-4 text-center text-sm">
					{#if hasRecoverableDownloads}
						<p class="mb-2 text-amber-200">{m.video_editor_recovery_available()}</p>
					{/if}
					<p class="font-medium">
						{m.video_editor_recording_files_saved({
							count: lastDownloads.length
						})}
					</p>
					<div class="mt-3 flex flex-wrap justify-center gap-2">
						{#each lastDownloads as d (d.url)}
							<a
								href={d.url}
								download={d.name}
								class="inline-flex min-h-11 items-center rounded border px-3 py-1.5 text-xs underline"
							>
								{m.video_editor_recording_download({
									source: sourceLabel(d.kind)
								})} ({formatBytes(d.size)})
							</a>
						{/each}
					</div>
					{#if hasRecoverableDownloads}
						<Button variant="ghost" class="mt-3 min-h-11" onclick={handleDiscardRecovery}>
							{m.video_editor_discard_recording()}
						</Button>
					{/if}
				</div>
			{:else if isRequesting}
				<div role="status" aria-live="polite" class="text-center">
					<p class="text-sm text-[oklch(0.65_0.015_55)]">
						{m.video_editor_recording_waiting()}
					</p>
				</div>
			{:else if isCountdown}
				<div role="status" aria-live="polite" class="text-center">
					<p class="font-mono text-5xl tabular-nums">
						{recorder.countdownRemaining}
					</p>
					<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
						{m.video_editor_record_countdown_active({
							seconds: recorder.countdownRemaining ?? 0
						})}
					</p>
				</div>
			{:else}
				<p class="text-sm text-[oklch(0.65_0.015_55)]">
					{m.record_preview_empty()}
				</p>
			{/if}

			{#if recorder.error}
				<div
					role="alert"
					class="w-full rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200"
				>
					{localizedRecorderError()}
				</div>
			{/if}
		</section>

		{#if !captureBusy}
			<!-- Selection -->
			<fieldset class="space-y-3 rounded-lg border border-[oklch(0.25_0.015_55)] p-3">
				<legend
					class="px-1 text-xs font-semibold tracking-widest text-[oklch(0.65_0.015_55)] uppercase"
					>{m.video_editor_recording_sources_description()}</legend
				>
				<div class="grid gap-2 sm:grid-cols-3">
					<label
						data-state={includeScreen ? 'checked' : 'unchecked'}
						class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 data-[state=checked]:border-[oklch(0.66_0.14_45)] data-[state=checked]:bg-[oklch(0.27_0.02_45)]"
					>
						<Checkbox
							bind:checked={includeScreen}
							onCheckedChange={(checked) =>
								recorderPreferences.set('includeScreen', checked === true)}
							aria-label={m.record_source_screen()}
						/>
						<span class="text-sm">{m.record_source_screen()}</span>
					</label>
					<label
						data-state={includeCamera ? 'checked' : 'unchecked'}
						class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 data-[state=checked]:border-[oklch(0.66_0.14_45)] data-[state=checked]:bg-[oklch(0.27_0.02_45)]"
					>
						<Checkbox
							bind:checked={includeCamera}
							onCheckedChange={(checked) =>
								recorderPreferences.set('includeCamera', checked === true)}
							aria-label={m.record_source_camera()}
						/>
						<span class="text-sm">{m.record_source_camera()}</span>
					</label>
					<label
						data-state={includeMic ? 'checked' : 'unchecked'}
						class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 data-[state=checked]:border-[oklch(0.66_0.14_45)] data-[state=checked]:bg-[oklch(0.27_0.02_45)]"
					>
						<Checkbox
							bind:checked={includeMic}
							onCheckedChange={(checked) =>
								recorderPreferences.set('includeMicrophone', checked === true)}
							aria-label={m.record_source_audio()}
						/>
						<span class="text-sm">{m.record_source_audio()}</span>
					</label>
				</div>

				<div class="flex flex-wrap gap-3">
					{#if includeCamera}
						<div class="flex flex-1 flex-col gap-1 text-xs">
							<span>{m.record_camera()}</span>
							<AppSelect
								value={cameraId}
								ariaLabel={m.record_camera()}
								options={[
									{ value: '', label: m.record_device_default() },
									...cameras.map((c) => ({
										value: c.deviceId,
										label: c.label || m.record_device_default()
									}))
								]}
								onValueChange={(value) => {
									cameraId = value;
									recorderPreferences.set('cameraDeviceId', value);
								}}
								class="h-11 min-w-40"
							/>
						</div>
					{/if}
					{#if includeMic}
						<div class="flex flex-1 flex-col gap-1 text-xs">
							<span>{m.record_microphone()}</span>
							<AppSelect
								value={micId}
								ariaLabel={m.record_microphone()}
								options={[
									{ value: '', label: m.record_device_default() },
									...microphones.map((d) => ({
										value: d.deviceId,
										label: d.label || m.record_device_default()
									}))
								]}
								onValueChange={(value) => {
									micId = value;
									recorderPreferences.set('microphoneDeviceId', value);
								}}
								class="h-11 min-w-40"
							/>
						</div>
					{/if}
				</div>

				{#if includeScreen || includeCamera}
					<div class="grid gap-3 sm:grid-cols-3">
						<div class="flex flex-col gap-1 text-xs">
							<span>{m.video_editor_export_resolution()}</span>
							<AppSelect
								value={videoResolution}
								ariaLabel={m.video_editor_export_resolution()}
								options={[
									{ value: '720p', label: '1280 × 720' },
									{ value: '1080p', label: '1920 × 1080' },
									{ value: '2160p', label: '3840 × 2160' }
								]}
								onValueChange={setVideoResolution}
								class="h-11"
							/>
						</div>
						<div class="flex flex-col gap-1 text-xs">
							<span>{m.video_editor_media_info_frame_rate()}</span>
							<AppSelect
								value={videoFrameRate}
								ariaLabel={m.video_editor_media_info_frame_rate()}
								options={[
									{ value: '24', label: '24 fps' },
									{ value: '30', label: '30 fps' },
									{ value: '60', label: '60 fps' }
								]}
								onValueChange={(value) => {
									videoFrameRate = value;
									recorderPreferences.set('videoFrameRate', selectedFrameRate());
								}}
								class="h-11"
							/>
						</div>
						{#if includeCamera}
							<div class="flex flex-col gap-1 text-xs">
								<span>{m.video_editor_record_camera_facing()}</span>
								<AppSelect
									value={cameraFacingMode}
									ariaLabel={m.video_editor_record_camera_facing()}
									options={[
										{ value: 'default', label: m.record_device_default() },
										{ value: 'user', label: m.video_editor_record_camera_front() },
										{ value: 'environment', label: m.video_editor_record_camera_back() }
									]}
									onValueChange={setCameraFacingMode}
									class="h-11"
								/>
							</div>
						{/if}
					</div>
				{/if}

				{#if includeScreen}
					<label class="flex min-h-11 items-center gap-1.5 text-sm">
						<Checkbox
							bind:checked={includeSystemAudio}
							onCheckedChange={(checked) =>
								recorderPreferences.set('includeSystemAudio', checked === true)}
						/>
						{m.record_system_audio()}
						<span class="text-xs text-[oklch(0.65_0.015_55)]"
							>({m.video_editor_system_audio_caveat()})</span
						>
					</label>
				{/if}

				<div class="grid gap-3 sm:grid-cols-2">
					<div class="flex flex-col gap-1 text-xs">
						<span>{m.video_editor_record_countdown()}</span>
						<AppSelect
							value={countdown}
							ariaLabel={m.video_editor_record_countdown()}
							options={[
								{ value: '0', label: m.video_editor_record_countdown_off() },
								{
									value: '3',
									label: m.video_editor_record_seconds({ seconds: 3 })
								},
								{
									value: '5',
									label: m.video_editor_record_seconds({ seconds: 5 })
								},
								{
									value: '10',
									label: m.video_editor_record_seconds({ seconds: 10 })
								}
							]}
							onValueChange={(value) => {
								countdown = value;
								recorderPreferences.set(
									'countdownSeconds',
									value === '10' ? 10 : value === '5' ? 5 : value === '3' ? 3 : 0
								);
							}}
							class="h-11"
						/>
					</div>
					<div class="flex flex-col gap-1 text-xs">
						<span>{m.video_editor_record_planned()}</span>
						<AppSelect
							value={plannedMinutes}
							ariaLabel={m.video_editor_record_planned()}
							options={[
								{
									value: '2',
									label: m.video_editor_record_minutes({ minutes: 2 })
								},
								{
									value: '5',
									label: m.video_editor_record_minutes({ minutes: 5 })
								},
								{
									value: '15',
									label: m.video_editor_record_minutes({ minutes: 15 })
								},
								{
									value: '30',
									label: m.video_editor_record_minutes({ minutes: 30 })
								}
							]}
							onValueChange={(value) => {
								plannedMinutes = value;
								recorderPreferences.set(
									'plannedMinutes',
									value === '30' ? 30 : value === '15' ? 15 : value === '2' ? 2 : 5
								);
							}}
							class="h-11"
						/>
					</div>
				</div>
				<p class="text-xs text-[oklch(0.65_0.015_55)]">
					{m.video_editor_record_estimate({ size: plannedEstimate })}
				</p>
			</fieldset>

			<Button class="mx-auto min-h-11 min-w-36" disabled={!hasSelection} onclick={handleStart}>
				{m.record_start()}
			</Button>
		{:else if isRequesting || isCountdown}
			<div class="flex justify-center">
				<Button variant="ghost" class="min-h-11" onclick={handleCancel}>
					{m.common_cancel()}
				</Button>
			</div>
		{:else}
			<div class="space-y-3 rounded-lg border border-[oklch(0.25_0.015_55)] p-3">
				<div class="grid gap-2 text-xs">
					{#if includeScreen}
						<div class="flex justify-between rounded bg-[oklch(0.18_0.01_55)] px-2 py-1.5">
							<span>{m.record_source_screen()}</span><span class="font-mono tabular-nums"
								>{m.video_editor_recording_chunks({
									count: recorder.counters.screen.chunks
								})} · {formatBytes(recorder.counters.screen.bytes)}</span
							>
						</div>
					{/if}

					{#if includeMic}
						<div class="flex flex-wrap gap-x-5 gap-y-2 text-sm">
							<label class="flex min-h-11 items-center gap-2">
								<Checkbox
									bind:checked={noiseSuppression}
									onCheckedChange={(checked) =>
										recorderPreferences.set('noiseSuppression', checked === true)}
								/>
								<span>{m.video_editor_voiceover_noise_suppression()}</span>
							</label>
							<label class="flex min-h-11 items-center gap-2">
								<Checkbox
									bind:checked={autoGainControl}
									onCheckedChange={(checked) =>
										recorderPreferences.set('autoGainControl', checked === true)}
								/>
								<span>{m.video_editor_voiceover_auto_gain()}</span>
							</label>
						</div>
					{/if}
					{#if includeCamera}
						<div class="flex justify-between rounded bg-[oklch(0.18_0.01_55)] px-2 py-1.5">
							<span>{m.record_source_camera()}</span><span class="font-mono tabular-nums"
								>{m.video_editor_recording_chunks({
									count: recorder.counters.camera.chunks
								})} · {formatBytes(recorder.counters.camera.bytes)}</span
							>
						</div>
					{/if}
					{#if includeMic}
						<div
							class="flex flex-wrap items-center justify-between gap-2 rounded bg-[oklch(0.18_0.01_55)] px-2 py-1.5"
						>
							<span>{m.record_source_audio()}</span>
							<div class="flex items-center gap-2">
								<div
									role="meter"
									aria-label={m.video_editor_voiceover_input_level()}
									aria-valuemin="0"
									aria-valuemax="100"
									aria-valuenow={micMeterWidth}
									aria-valuetext={`${micMeterWidth}%`}
									class="h-1.5 w-20 overflow-hidden rounded-full bg-white/10"
								>
									<div
										class="h-full rounded-full transition-[width,background-color] duration-75 {micMeterWidth >
										85
											? 'bg-red-400'
											: 'bg-emerald-400'}"
										style:width={`${micMeterWidth}%`}
									></div>
								</div>
								<span class="font-mono tabular-nums"
									>{m.video_editor_recording_chunks({
										count: recorder.counters.microphone.chunks
									})} · {formatBytes(recorder.counters.microphone.bytes)}</span
								>
							</div>
						</div>
					{/if}
				</div>
				<div class="flex flex-wrap justify-center gap-2">
					<Button
						variant="destructive"
						class="min-h-11 min-w-32"
						disabled={isStopping}
						onclick={handleStop}>{isStopping ? m.common_loading() : m.record_stop_save()}</Button
					>
					<Button variant="ghost" class="min-h-11" onclick={handleCancel}
						>{m.common_cancel()}</Button
					>
				</div>
			</div>
		{/if}
	</main>
</div>
