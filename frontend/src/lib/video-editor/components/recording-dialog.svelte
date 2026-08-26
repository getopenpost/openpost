<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { showToast } from '$lib/toast';
	import {
		recorder,
		listRecorderDevices,
		estimateBytesPerMinute,
		formatBytes,
		type RecorderKind,
		type RecorderSelection
	} from '$lib/video-editor/recorder/recorder.svelte';
	import { insertRecordingArtifacts } from '$lib/video-editor/recorder/insert-recording';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';

	let {
		open = false,
		projectId,
		onopenchange = () => {},
		oninserted = () => {}
	}: {
		open: boolean;
		projectId: string;
		onopenchange?: (v: boolean) => void;
		oninserted?: (itemId: string) => void;
	} = $props();

	let cameras = $state<MediaDeviceInfo[]>([]);
	let microphones = $state<MediaDeviceInfo[]>([]);
	let includeScreen = $state(true);
	let includeCamera = $state(false);
	let includeMic = $state(true);
	let includeSystemAudio = $state(true);
	let cameraId = $state<string>('');
	let micId = $state<string>('');
	let countdown = $state<string>('0');
	let plannedMinutes = $state<string>('5');
	let inserting = $state(false);
	let recoveryUrls = $state<Array<{ kind: RecorderKind; url: string; name: string }>>([]);
	let availableBytes = $state<number | null>(null);

	const selection: RecorderSelection = $derived({
		screen: includeScreen,
		camera: includeCamera,
		microphone: includeMic
	});
	const hasSelection = $derived(includeScreen || includeCamera || includeMic);
	const estimate = $derived(hasSelection ? formatBytes(estimateBytesPerMinute(selection)) : null);
	const plannedEstimate = $derived(() => {
		const minutes = Number(plannedMinutes) || 5;
		const perMin = estimateBytesPerMinute(selection);
		return formatBytes(Math.ceil(perMin * minutes * 1.2));
	});
	const plannedBytes = $derived(
		Math.ceil(estimateBytesPerMinute(selection) * (Number(plannedMinutes) || 5) * 1.2)
	);
	const sourceSummary = $derived.by(() => {
		const sources: string[] = [];
		if (includeScreen) sources.push(m.record_source_screen());
		if (includeCamera) sources.push(m.record_source_camera());
		if (includeMic) sources.push(m.record_source_audio());
		return sources.join(' + ');
	});
	const countdownActive = $derived(recorder.status === 'countdown');
	const requestingActive = $derived(recorder.status === 'requesting');
	const recordingActive = $derived(recorder.status === 'recording');
	const stoppingActive = $derived(recorder.status === 'stopping');
	const captureBusy = $derived(
		requestingActive || countdownActive || recordingActive || stoppingActive
	);
	const elapsed = $derived.by(() => {
		const secs = Math.floor(recorder.elapsedMs / 1000);
		return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
	});

	async function refreshDevices(): Promise<void> {
		try {
			const lists = await listRecorderDevices();
			cameras = lists.cameras;
			microphones = lists.microphones;
			if (cameraId && !cameras.some((c) => c.deviceId === cameraId)) cameraId = '';
			if (micId && !microphones.some((d) => d.deviceId === micId)) micId = '';
		} catch {
			// ignore
		}
	}

	async function refreshQuota(): Promise<void> {
		try {
			const est = await navigator.storage?.estimate?.();
			availableBytes =
				est?.quota !== undefined && est.usage !== undefined ? est.quota - est.usage : null;
		} catch {
			availableBytes = null;
		}
	}

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

	onMount(() => {
		void refreshDevices();
		void refreshQuota();
		const handler = () => void refreshDevices();
		navigator.mediaDevices?.addEventListener?.('devicechange', handler);
		return () => {
			navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
			recoveryUrls.forEach((recovery) => URL.revokeObjectURL(recovery.url));
			void recorder.cancel().then(() => recorder.clearRecoverableAndDiscard());
		};
	});

	$effect(() => {
		if (open) {
			void refreshDevices();
			void refreshQuota();
		}
	});

	$effect(() => {
		// keep counters updated via snapshot reactivity
		void recorder.counters;
	});

	async function handleStart(): Promise<void> {
		if (!hasSelection) {
			showToast(m.video_editor_recording_failed(), 'error');
			return;
		}
		recoveryUrls.forEach((r) => URL.revokeObjectURL(r.url));
		recoveryUrls = [];
		await recorder.clearRecoverableAndDiscard();
		const countdownSeconds = Number(countdown) || 0;
		try {
			await recorder.startWithSelection(selection, {
				cameraDeviceId: cameraId || null,
				microphoneDeviceId: micId || null,
				includeSystemAudio,
				countdownSeconds
			});
		} catch {
			showToast(localizedRecorderError(), 'error');
		}
	}

	async function handleStop(): Promise<void> {
		if (inserting) return;
		inserting = true;
		try {
			const artifacts = await recorder.stop();
			if (artifacts.length === 0) {
				showToast(m.video_editor_recording_cancelled(), 'info');
				return;
			}
			// Preserve recoverable URLs for download if timeline insert later fails
			recoveryUrls = artifacts.map((a) => ({
				kind: a.kind,
				url: URL.createObjectURL(a.blob),
				name: `recording-${a.kind}-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.${a.mimeType.includes('audio') ? 'webm' : 'webm'}`
			}));
			try {
				const anchor = timelineStore.currentFrame;
				const result = await insertRecordingArtifacts(projectId, artifacts, anchor);
				editorSession.scheduleAutosave();
				result.itemIds.forEach((id) => oninserted(id));
				showToast(m.video_editor_recording_inserted(), 'success');
				// clear recovery after successful insert
				recoveryUrls.forEach((r) => URL.revokeObjectURL(r.url));
				recoveryUrls = [];
				await recorder.clearRecoverableAndDiscard();
				onopenchange(false);
			} catch (error) {
				showToast(m.video_editor_recording_failed(), 'error');
				// keep recoveryUrls so user can download
			}
		} catch {
			showToast(localizedRecorderError(), 'error');
		} finally {
			inserting = false;
		}
	}

	async function handleCancel(): Promise<void> {
		await recorder.cancel();
		await recorder.clearRecoverableAndDiscard();
		recoveryUrls.forEach((r) => URL.revokeObjectURL(r.url));
		recoveryUrls = [];
		showToast(m.video_editor_recording_cancelled(), 'info');
	}

	function handleDialogOpen(v: boolean): void {
		if (!v && captureBusy) return;
		onopenchange(v);
		if (!v) void recorder.cancel();
	}
</script>

<Dialog.Root {open} onOpenChange={handleDialogOpen}>
	<Dialog.Content
		class="video-editor-theme max-h-[90dvh] w-[min(640px,calc(100vw-2rem))] overflow-y-auto"
		aria-describedby={undefined}
	>
		<Dialog.Header>
			<Dialog.Title>{m.video_editor_record_screen()}</Dialog.Title>
			<Dialog.Description>{m.video_editor_record_screen_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<!-- Preflight -->
			<fieldset class="space-y-3 rounded-lg border border-[oklch(0.25_0.015_55)] p-3">
				<legend class="px-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
					{m.video_editor_recording_setup()}
				</legend>

				<div class="grid gap-3 sm:grid-cols-3">
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
						<label class="flex min-w-40 flex-1 flex-col gap-1 text-xs">
							<span>{m.record_camera()}</span>
							<AppSelect
								value={cameraId}
								options={cameras.map((c) => ({
									value: c.deviceId,
									label: c.label || m.record_device_default()
								}))}
								ariaLabel={m.record_camera()}
								onValueChange={(v) => (cameraId = v)}
								class="h-11"
							/>
						</label>
					{/if}
					{#if includeMic}
						<label class="flex min-w-40 flex-1 flex-col gap-1 text-xs">
							<span>{m.record_microphone()}</span>
							<AppSelect
								value={micId}
								options={[
									{ value: '', label: m.record_device_default() },
									...microphones.map((d) => ({
										value: d.deviceId,
										label: d.label || m.record_device_default()
									}))
								]}
								ariaLabel={m.record_microphone()}
								onValueChange={(v) => (micId = v)}
								class="h-11"
							/>
						</label>
					{/if}
				</div>

				{#if includeScreen}
					<label class="flex min-h-11 items-center gap-2 text-sm">
						<Checkbox bind:checked={includeSystemAudio} />
						<span>{m.record_system_audio()}</span>
						<span class="text-xs text-muted-foreground"
							>({m.video_editor_system_audio_caveat()})</span
						>
					</label>
				{/if}

				<div class="grid gap-3 sm:grid-cols-2">
					<label class="flex flex-col gap-1 text-xs">
						<span>{m.video_editor_record_countdown()}</span>
						<AppSelect
							value={countdown}
							options={[
								{ value: '0', label: m.video_editor_record_countdown_off() },
								{
									value: '3',
									label: m.video_editor_record_seconds({ seconds: 3 })
								},
								{
									value: '5',
									label: m.video_editor_record_seconds({ seconds: 5 })
								}
							]}
							ariaLabel={m.video_editor_record_countdown()}
							onValueChange={(v) => (countdown = v)}
							class="h-11"
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs">
						<span>{m.video_editor_record_planned()}</span>
						<AppSelect
							value={plannedMinutes}
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
							ariaLabel={m.video_editor_record_planned()}
							onValueChange={(v) => (plannedMinutes = v)}
							class="h-11"
						/>
					</label>
				</div>

				{#if estimate}
					<p class="text-xs text-muted-foreground">
						{m.video_editor_record_estimate({ size: plannedEstimate() })}
						{#if availableBytes !== null}
							<span>
								{availableBytes < plannedBytes
									? m.video_editor_recording_space({
											available: formatBytes(availableBytes)
										})
									: m.video_editor_recording_available_space({
											available: formatBytes(availableBytes)
										})}
							</span>
						{/if}
					</p>
				{/if}

				{#if !hasSelection}
					<p
						role="alert"
						class="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200"
					>
						{m.video_editor_recording_select_source()}
					</p>
				{/if}

				{#if recorder.error}
					<div
						role="alert"
						class="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200"
					>
						{localizedRecorderError()}
					</div>
				{/if}
			</fieldset>

			<!-- Countdown / Progress -->
			{#if requestingActive}
				<div
					role="status"
					aria-live="polite"
					class="space-y-3 rounded-lg bg-[oklch(0.18_0.01_55)] p-4 text-center"
				>
					<p class="text-sm">{m.video_editor_recording_waiting()}</p>
					<Button variant="ghost" class="min-h-11" onclick={handleCancel}>
						{m.common_cancel()}
					</Button>
				</div>
			{:else if countdownActive}
				<div
					role="status"
					aria-live="polite"
					class="rounded-lg bg-[oklch(0.18_0.01_55)] p-6 text-center"
				>
					<p class="font-mono text-5xl tabular-nums">
						{recorder.countdownRemaining}
					</p>
					<p class="mt-2 text-sm text-muted-foreground">
						{m.video_editor_record_countdown_active({
							seconds: recorder.countdownRemaining ?? 0
						})}
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.video_editor_recording_waiting()}
					</p>
				</div>
			{:else if recordingActive || stoppingActive}
				<div class="space-y-3 rounded-lg border border-[oklch(0.25_0.015_55)] p-3">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<span aria-live="polite" class="flex items-center gap-2 font-mono text-lg tabular-nums">
							<span class="size-2 animate-pulse rounded-full bg-red-500" aria-hidden="true"></span>
							{elapsed}
						</span>
						<span class="text-xs text-muted-foreground">
							{sourceSummary}
						</span>
					</div>

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
							<div class="flex justify-between rounded bg-[oklch(0.18_0.01_55)] px-2 py-1.5">
								<span>{m.record_source_audio()}</span><span class="font-mono tabular-nums"
									>{m.video_editor_recording_chunks({
										count: recorder.counters.microphone.chunks
									})} · {formatBytes(recorder.counters.microphone.bytes)}</span
								>
							</div>
						{/if}
					</div>

					<div class="flex flex-wrap justify-center gap-2 pt-1">
						<Button
							variant="destructive"
							class="min-h-11 min-w-32"
							disabled={stoppingActive}
							onclick={handleStop}
						>
							{stoppingActive ? m.common_loading() : m.video_editor_recording_stop()}
						</Button>
						<Button
							variant="ghost"
							class="min-h-11"
							disabled={stoppingActive}
							onclick={handleCancel}
						>
							{m.common_cancel()}
						</Button>
					</div>
				</div>
			{/if}

			<!-- Recovery -->
			{#if recoveryUrls.length > 0}
				<div
					role="status"
					class="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
				>
					<p class="font-medium text-amber-100">
						{m.video_editor_recording_storage_stopped()}
					</p>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each recoveryUrls as r (r.url)}
							<a
								href={r.url}
								download={r.name}
								class="rounded border px-2 py-1 underline focus-visible:outline-2 focus-visible:outline-amber-300"
							>
								{m.video_editor_recording_download({
									source: sourceLabel(r.kind)
								})}
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Previews when idle -->
			{#if !captureBusy}
				<div class="flex flex-wrap justify-center gap-2 pt-2">
					<Button
						class="min-h-11 min-w-36"
						disabled={!hasSelection || recordingActive || stoppingActive}
						onclick={handleStart}
					>
						{m.video_editor_recording_start()}
					</Button>
					<Button variant="outline" class="min-h-11" onclick={() => handleDialogOpen(false)}>
						{m.common_close()}
					</Button>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
