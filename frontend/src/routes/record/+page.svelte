<!-- Record: separate screen / camera / mic artifacts with shared timebase -->
<script lang="ts">
	import { onMount } from 'svelte';
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
		estimateBytesPerMinute
	} from '$lib/video-editor/recorder/recorder.svelte';

	const recorder = new ScreenCaptureRecorder();
	let cameras = $state<MediaDeviceInfo[]>([]);
	let microphones = $state<MediaDeviceInfo[]>([]);
	let includeScreen = $state(true);
	let includeCamera = $state(false);
	let includeMic = $state(false);
	let includeSystemAudio = $state(true);
	let cameraId = $state('');
	let micId = $state('');
	let countdown = $state('0');
	let plannedMinutes = $state('5');
	let screenPreviewEl = $state<HTMLVideoElement | null>(null);
	let cameraPreviewEl = $state<HTMLVideoElement | null>(null);
	let lastDownloads = $state<Array<{ url: string; name: string; kind: string; size: number }>>([]);

	const hasSelection = $derived(includeScreen || includeCamera || includeMic);
	const elapsed = $derived.by(() => {
		const secs = Math.floor(recorder.elapsedMs / 1000);
		return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
	});

	onMount(() => {
		void listRecorderDevices().then((lists) => {
			cameras = lists.cameras;
			microphones = lists.microphones;
		});
		const handler = () =>
			void listRecorderDevices().then((l) => {
				cameras = l.cameras;
				microphones = l.microphones;
			});
		navigator.mediaDevices?.addEventListener?.('devicechange', handler);
		return () => {
			navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
			void recorder.cancel();
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
			showToast('Select at least one source to record.', 'error');
			return;
		}
		for (const d of lastDownloads) URL.revokeObjectURL(d.url);
		lastDownloads = [];
		try {
			await recorder.startWithSelection(
				{ screen: includeScreen, camera: includeCamera, microphone: includeMic },
				{
					cameraDeviceId: cameraId || null,
					microphoneDeviceId: micId || null,
					includeSystemAudio,
					countdownSeconds: Number(countdown) || 0
				}
			);
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
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
				const ext = a.mimeType.includes('audio') ? 'webm' : 'webm';
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
			lastDownloads = downloads;
			showToast(m.record_saved(), 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}

	async function handleCancel(): Promise<void> {
		await recorder.cancel();
		showToast(m.record_discarded(), 'info');
	}

	const isRecording = $derived(
		recorder.status === 'recording' ||
			recorder.status === 'countdown' ||
			recorder.status === 'requesting'
	);
	const isCountdown = $derived(recorder.status === 'countdown');
	const perMin = $derived(
		estimateBytesPerMinute({ screen: includeScreen, camera: includeCamera, microphone: includeMic })
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
					<p class="font-medium">Done - {lastDownloads.length} file(s) saved</p>
					<div class="mt-3 flex flex-wrap justify-center gap-2">
						{#each lastDownloads as d (d.url)}
							<a
								href={d.url}
								download={d.name}
								class="rounded border px-3 py-1.5 text-xs underline"
							>
								Download {d.kind} ({formatBytes(d.size)})
							</a>
						{/each}
					</div>
				</div>
			{:else if isCountdown}
				<div role="status" aria-live="polite" class="text-center">
					<p class="font-mono text-5xl tabular-nums">{recorder.countdownRemaining}</p>
					<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
						{m.video_editor_record_countdown_active({ seconds: recorder.countdownRemaining ?? 0 })}
					</p>
				</div>
			{:else}
				<p class="text-sm text-[oklch(0.65_0.015_55)]">{m.record_preview_empty()}</p>
			{/if}

			{#if recorder.error}
				<div
					role="alert"
					class="w-full rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200"
				>
					{recorder.errorMessage}
				</div>
			{/if}
		</section>

		{#if !isRecording}
			<!-- Selection -->
			<fieldset class="space-y-3 rounded-lg border border-[oklch(0.25_0.015_55)] p-3">
				<legend
					class="px-1 text-xs font-semibold tracking-widest text-[oklch(0.65_0.015_55)] uppercase"
					>Sources - separate files with shared timebase</legend
				>
				<div class="grid gap-2 sm:grid-cols-3">
					<label
						class="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 has-[input:checked]:border-[oklch(0.66_0.14_45)] has-[input:checked]:bg-[oklch(0.27_0.02_45)]"
					>
						<input
							type="checkbox"
							bind:checked={includeScreen}
							class="size-4 accent-[oklch(0.66_0.14_45)]"
						/>
						<span class="text-sm">{m.record_source_screen()}</span>
					</label>
					<label
						class="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 has-[input:checked]:border-[oklch(0.66_0.14_45)] has-[input:checked]:bg-[oklch(0.27_0.02_45)]"
					>
						<input
							type="checkbox"
							bind:checked={includeCamera}
							class="size-4 accent-[oklch(0.66_0.14_45)]"
						/>
						<span class="text-sm">{m.record_source_camera()}</span>
					</label>
					<label
						class="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 has-[input:checked]:border-[oklch(0.66_0.14_45)] has-[input:checked]:bg-[oklch(0.27_0.02_45)]"
					>
						<input
							type="checkbox"
							bind:checked={includeMic}
							class="size-4 accent-[oklch(0.66_0.14_45)]"
						/>
						<span class="text-sm">{m.record_source_audio()}</span>
					</label>
				</div>

				<div class="flex flex-wrap gap-3">
					{#if includeCamera}
						<label class="flex flex-1 flex-col gap-1 text-xs">
							<span>{m.record_camera()}</span>
							<AppSelect
								bind:value={cameraId}
								ariaLabel={m.record_camera()}
								options={cameras.map((c) => ({
									value: c.deviceId,
									label: c.label || m.record_device_default()
								}))}
								class="h-11 min-w-40"
							/>
						</label>
					{/if}
					{#if includeMic}
						<label class="flex flex-1 flex-col gap-1 text-xs">
							<span>{m.record_microphone()}</span>
							<AppSelect
								bind:value={micId}
								ariaLabel={m.record_microphone()}
								options={[
									{ value: '', label: m.record_device_default() },
									...microphones.map((d) => ({
										value: d.deviceId,
										label: d.label || m.record_device_default()
									}))
								]}
								class="h-11 min-w-40"
							/>
						</label>
					{/if}
				</div>

				{#if includeScreen}
					<label class="flex items-center gap-1.5 text-sm">
						<Checkbox bind:checked={includeSystemAudio} />
						{m.record_system_audio()}
						<span class="text-xs text-[oklch(0.65_0.015_55)]"
							>({m.video_editor_system_audio_caveat()})</span
						>
					</label>
				{/if}

				<div class="grid gap-3 sm:grid-cols-2">
					<label class="flex flex-col gap-1 text-xs">
						<span>{m.video_editor_record_countdown()}</span>
						<AppSelect
							bind:value={countdown}
							ariaLabel={m.video_editor_record_countdown()}
							options={[
								{ value: '0', label: m.video_editor_record_countdown_off() },
								{ value: '3', label: m.video_editor_record_seconds({ seconds: 3 }) },
								{ value: '5', label: m.video_editor_record_seconds({ seconds: 5 }) }
							]}
							class="h-11"
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span>{m.video_editor_record_planned()}</span>
						<AppSelect
							bind:value={plannedMinutes}
							ariaLabel={m.video_editor_record_planned()}
							options={[
								{ value: '2', label: m.video_editor_record_minutes({ minutes: 2 }) },
								{ value: '5', label: m.video_editor_record_minutes({ minutes: 5 }) },
								{ value: '15', label: m.video_editor_record_minutes({ minutes: 15 }) }
							]}
							class="h-11"
						/>
					</label>
				</div>
				<p class="text-xs text-[oklch(0.65_0.015_55)]">
					{m.video_editor_record_estimate({ size: plannedEstimate })}
				</p>
			</fieldset>

			<Button class="mx-auto min-h-11 min-w-36" disabled={!hasSelection} onclick={handleStart}>
				{m.record_start()}
			</Button>
		{:else}
			<div class="space-y-3 rounded-lg border border-[oklch(0.25_0.015_55)] p-3">
				<div class="grid gap-2 text-xs">
					{#if includeScreen}
						<div class="flex justify-between rounded bg-[oklch(0.18_0.01_55)] px-2 py-1.5">
							<span>Screen</span><span class="font-mono tabular-nums"
								>{recorder.counters.screen.chunks} chunks · {formatBytes(
									recorder.counters.screen.bytes
								)}</span
							>
						</div>
					{/if}
					{#if includeCamera}
						<div class="flex justify-between rounded bg-[oklch(0.18_0.01_55)] px-2 py-1.5">
							<span>Camera</span><span class="font-mono tabular-nums"
								>{recorder.counters.camera.chunks} chunks · {formatBytes(
									recorder.counters.camera.bytes
								)}</span
							>
						</div>
					{/if}
					{#if includeMic}
						<div class="flex justify-between rounded bg-[oklch(0.18_0.01_55)] px-2 py-1.5">
							<span>Mic</span><span class="font-mono tabular-nums"
								>{recorder.counters.microphone.chunks} chunks · {formatBytes(
									recorder.counters.microphone.bytes
								)}</span
							>
						</div>
					{/if}
				</div>
				<div class="flex flex-wrap justify-center gap-2">
					<Button variant="destructive" class="min-h-11 min-w-32" onclick={handleStop}
						>{m.record_stop_save()}</Button
					>
					<Button variant="ghost" class="min-h-11" onclick={handleCancel}
						>{m.common_cancel()}</Button
					>
				</div>
			</div>
		{/if}
	</main>
</div>
