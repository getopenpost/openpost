<!--
THESIS: Starting a video is one decision with clear local consequences.
OWN-WORLD: OpenPost compact controls, warm surfaces, structural dividers, and restrained orange action.
STORY: Pick local files, set up separate recording tracks, choose licensed stock, or start with a clean timeline.
FIRST VIEWPORT: Back navigation, plain-language setup choices, exact system-audio caveat, and one primary action.
FORM: Operate surface; no template carousel, hidden permissions, automatic upload, or dense capture dashboard.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import { loadVideoEditorConfig, type StockAsset } from '$lib/video-editor/api';
	import { m } from '$lib/paraglide/messages';
	import { detectVideoEditorCapabilities } from '$lib/video-editor/capabilities';
	import {
		addFileToProject,
		addRecordingToProject,
		createBlankLocalVideoProject,
		createLocalVideoProjectFromFiles,
		formatBytes
	} from '$lib/video-editor/project';
	import { VideoRecordingSession, type RecordingSessionState } from '$lib/video-editor/recorder';
	import {
		deleteRecording,
		deleteRecordingManifest,
		deleteLocalVideoProject,
		estimateStorageBudget,
		readProjectFile,
		removeProjectFile,
		requestPersistentVideoStorage,
		saveLocalVideoProject,
		writeProjectStream
	} from '$lib/video-editor/storage';
	import type { LocalVideoProject } from '$lib/video-editor/types';
	import ArrowLeftIcon from 'lucide-svelte/icons/arrow-left';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import FileVideoIcon from 'lucide-svelte/icons/file-video';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import MicIcon from 'lucide-svelte/icons/mic';
	import MonitorIcon from 'lucide-svelte/icons/monitor-up';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import ScissorsIcon from 'lucide-svelte/icons/scissors';
	import SlidersHorizontalIcon from 'lucide-svelte/icons/sliders-horizontal';
	import VolumeIcon from 'lucide-svelte/icons/volume-2';

	let mode = $derived($page.url.searchParams.get('mode') ?? 'import');
	const composerHandoff = $derived(Boolean($page.url.searchParams.get('return_token')));
	let editingMode = $state<'quick-cut' | 'editor'>('editor');
	let error = $state('');
	let creating = $state(false);
	let dragging = $state(false);
	let camera = $state(true);
	let microphone = $state(true);
	let systemAudio = $state(true);
	let recording = $state<VideoRecordingSession | null>(null);
	let recordingProject = $state.raw<LocalVideoProject | null>(null);
	let recordingState = $state<RecordingSessionState | null>(null);
	let entryReady = $state(false);
	let countdownSeconds = $state<0 | 3 | 5>(3);
	let countdownRemaining = $state(0);
	let plannedMinutes = $state<5 | 10 | 20>(10);
	let availableDevices = $state<MediaDeviceInfo[]>([]);
	let cameraDeviceID = $state('');
	let microphoneDeviceID = $state('');
	let cameraLayout = $state<'circle' | 'rounded' | 'portrait' | 'side-by-side' | 'full'>('circle');
	let switchingDevice = $state<'camera' | 'microphone' | null>(null);
	const estimatedRecordingBytes = $derived(
		Math.ceil(
			plannedMinutes *
				60 *
				((10_000_000 + (camera ? 3_000_000 : 0)) / 8 + (microphone || systemAudio ? 48_000 : 0))
		)
	);

	onMount(() => {
		if (!composerHandoff && $page.url.searchParams.get('workflow') === 'quick-cut') {
			editingMode = 'quick-cut';
		}
		void initializeEntry();
	});

	async function initializeEntry(): Promise<void> {
		const [config, capabilities] = await Promise.all([
			loadVideoEditorConfig(),
			detectVideoEditorCapabilities()
		]);
		if (!config.enabled) {
			await goto(resolve('/video-editor' as '/'), { replaceState: true });
			return;
		}
		if (!capabilities.supported) {
			await goto(resolve('/video-editor/unsupported' as '/'), { replaceState: true });
			return;
		}
		entryReady = true;
		await refreshDevices();
		const mediaID = $page.url.searchParams.get('source_media');
		if (mediaID) await createFromOpenPostMedia(mediaID);
	}

	async function createFromOpenPostMedia(mediaID: string): Promise<void> {
		if (creating) return;
		creating = true;
		error = '';
		let project: LocalVideoProject | null = null;
		let temporaryPath = '';
		try {
			const response = await fetch(getAuthenticatedMediaByID(mediaID), {
				credentials: 'include'
			});
			if (!response.ok || !response.body) throw new Error(m.media_read_failed());
			const mimeType = response.headers.get('Content-Type') || 'application/octet-stream';
			const name =
				$page.url.searchParams.get('source_name') ||
				`openpost-media-${mediaID}.${mimeType.startsWith('video/') ? 'mp4' : 'bin'}`;
			project = await createBlankLocalVideoProject(name.replace(/\.[^.]+$/u, ''), editingMode);
			const expectedSize = Number(response.headers.get('Content-Length') ?? 0);
			const stored = await writeProjectStream(
				project.id,
				'temp',
				`openpost-media-${mediaID}`,
				response.body,
				{ expectedSize: expectedSize > 0 ? expectedSize : undefined }
			);
			temporaryPath = stored.path;
			const localFile = await readProjectFile(stored.path);
			if (!localFile) throw new Error(m.media_read_failed());
			await addFileToProject(
				project,
				new File([localFile], name, { type: mimeType, lastModified: localFile.lastModified })
			);
			const saved = await saveLocalVideoProject(project);
			await removeProjectFile(stored.path);
			temporaryPath = '';
			await openProject(saved.id);
		} catch (cause) {
			if (temporaryPath) await removeProjectFile(temporaryPath).catch(() => undefined);
			if (project) await deleteLocalVideoProject(project.id);
			error = cause instanceof Error ? cause.message : m.video_editor_create_failed();
			creating = false;
		}
	}

	async function refreshDevices(): Promise<void> {
		if (!navigator.mediaDevices?.enumerateDevices) return;
		availableDevices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
		cameraDeviceID ||=
			availableDevices.find((device) => device.kind === 'videoinput')?.deviceId ?? '';
		microphoneDeviceID ||=
			availableDevices.find((device) => device.kind === 'audioinput')?.deviceId ?? '';
	}

	async function createFromFiles(files: File[]): Promise<void> {
		if (files.length === 0 || creating) return;
		if (
			editingMode === 'quick-cut' &&
			(files.length !== 1 || !files[0]?.type.startsWith('video/'))
		) {
			error = m.video_editor_quick_single_video();
			return;
		}
		creating = true;
		error = '';
		try {
			void requestPersistentVideoStorage();
			const project = await createLocalVideoProjectFromFiles(
				files,
				undefined,
				undefined,
				editingMode
			);
			await openProject(project.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_create_failed();
			creating = false;
		}
	}

	async function chooseFiles(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		await createFromFiles(files);
	}

	async function createBlank(): Promise<void> {
		if (creating) return;
		creating = true;
		error = '';
		try {
			const project = await createBlankLocalVideoProject();
			await openProject(project.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_create_failed();
			creating = false;
		}
	}

	async function startRecording(): Promise<void> {
		if (recording || creating) return;
		creating = true;
		error = '';
		let project: LocalVideoProject | null = null;
		try {
			await requestPersistentVideoStorage();
			const budget = await estimateStorageBudget(estimatedRecordingBytes);
			if (!budget.can_continue) {
				throw new Error(
					m.video_editor_recording_space({ available: formatBytes(budget.available_bytes) })
				);
			}
			project = await createBlankLocalVideoProject('Screen recording');
			recordingProject = project;
			recording = await VideoRecordingSession.start({
				projectID: project.id,
				camera,
				microphone,
				systemAudio,
				cameraDeviceID: cameraDeviceID || undefined,
				microphoneDeviceID: microphoneDeviceID || undefined,
				countdownSeconds,
				onCountdown: (remaining) => (countdownRemaining = remaining),
				onState: (state) => (recordingState = state)
			});
			await refreshDevices();
		} catch (cause) {
			if (project) await deleteLocalVideoProject(project.id);
			recordingProject = null;
			error =
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? m.video_editor_recording_cancelled()
					: cause instanceof Error
						? cause.message
						: m.video_editor_create_failed();
		} finally {
			countdownRemaining = 0;
			creating = false;
		}
	}

	async function stopRecording(): Promise<void> {
		if (!recording || !recordingProject || creating) return;
		creating = true;
		try {
			const manifest = await recording.stop();
			await addRecordingToProject(recordingProject, manifest, { cameraLayout });
			const saved = await saveLocalVideoProject(recordingProject);
			await deleteRecordingManifest(manifest.id);
			await openProject(saved.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_create_failed();
			creating = false;
		}
	}

	async function switchRecordingInput(
		kind: 'camera' | 'microphone',
		deviceID: string
	): Promise<void> {
		if (!recording || !deviceID || switchingDevice) return;
		switchingDevice = kind;
		error = '';
		try {
			await recording.switchInput(kind, deviceID);
			if (kind === 'camera') cameraDeviceID = deviceID;
			else microphoneDeviceID = deviceID;
			await refreshDevices();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_device_switch_failed();
		} finally {
			switchingDevice = null;
		}
	}

	async function addStock(file: File, asset: StockAsset): Promise<void> {
		if (creating) return;
		creating = true;
		const project = await createBlankLocalVideoProject(file.name.replace(/\.[^.]+$/u, ''));
		try {
			await addFileToProject(project, file, undefined, {
				provenance: {
					provider: asset.provider,
					external_id: asset.external_id,
					source_url: asset.source_url,
					creator_name: asset.creator_name,
					creator_url: asset.creator_url,
					license_name: asset.license_name,
					license_url: asset.license_url,
					attribution_text: asset.attribution_text
				}
			});
			const saved = await saveLocalVideoProject(project);
			await openProject(saved.id);
		} catch (cause) {
			await deleteLocalVideoProject(project.id);
			error = cause instanceof Error ? cause.message : m.video_editor_create_failed();
			creating = false;
		}
	}

	async function openProject(id: string): Promise<void> {
		const query = new URLSearchParams();
		for (const key of ['return_token', 'required_variants', 'variant_renditions']) {
			const value = $page.url.searchParams.get(key);
			if (value) query.set(key, value);
		}
		await goto(resolve(`/video-editor/${id}${query.size ? `?${query.toString()}` : ''}` as '/'), {
			replaceState: true
		});
	}

	function triggerFilePicker(): void {
		document.querySelector<HTMLInputElement>('#video-editor-new-files')?.click();
	}

	function durationLabel(milliseconds: number): string {
		const seconds = Math.floor(milliseconds / 1_000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>{m.video_editor_new_meta_title()}</title>
</svelte:head>

<div class="video-editor-theme min-h-dvh bg-background text-foreground">
	<header class="border-b">
		<div class="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
			<a href={resolve('/')} class="flex min-h-11 items-center" aria-label={m.common_openpost()}>
				<Logo width={112} height={33} />
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">/ {m.video_editor_title()}</span>
			<div class="ml-auto"><LanguageSwitcher compact /></div>
		</div>
	</header>

	<main class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
		<Button href="/video-editor" variant="ghost" size="sm" class="-ml-2">
			<ArrowLeftIcon class="size-4" />
			{m.video_editor_back()}
		</Button>

		<div class="mt-5 max-w-2xl">
			<h1 class="text-2xl font-semibold tracking-tight">{m.video_editor_new_heading()}</h1>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">{m.video_editor_new_intro()}</p>
		</div>

		{#if mode === 'import'}
			<section class="mt-8" aria-labelledby="video-editor-workflow-title">
				<h2 id="video-editor-workflow-title" class="text-sm font-semibold">
					{m.video_editor_workflow_heading()}
				</h2>
				<div class="mt-3 grid gap-3 sm:grid-cols-2">
					<button
						type="button"
						class={[
							'flex min-h-28 items-start gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							composerHandoff && 'cursor-not-allowed opacity-50',
							editingMode === 'quick-cut'
								? 'border-primary bg-primary/5 shadow-sm'
								: 'hover:bg-muted/40'
						]}
						disabled={composerHandoff}
						title={composerHandoff ? m.video_editor_quick_handoff_full() : undefined}
						onclick={() => (editingMode = 'quick-cut')}
					>
						<span
							class="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
						>
							<ScissorsIcon class="size-5" />
						</span>
						<span>
							<span class="block font-medium">{m.video_editor_workflow_quick()}</span>
							<span class="mt-1 block text-sm leading-5 text-muted-foreground">
								{m.video_editor_workflow_quick_description()}
							</span>
						</span>
					</button>
					<button
						type="button"
						class={[
							'flex min-h-28 items-start gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							editingMode === 'editor'
								? 'border-primary bg-primary/5 shadow-sm'
								: 'hover:bg-muted/40'
						]}
						onclick={() => (editingMode = 'editor')}
					>
						<span
							class="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
						>
							<SlidersHorizontalIcon class="size-5" />
						</span>
						<span>
							<span class="block font-medium">{m.video_editor_workflow_full()}</span>
							<span class="mt-1 block text-sm leading-5 text-muted-foreground">
								{m.video_editor_workflow_full_description()}
							</span>
						</span>
					</button>
				</div>
			</section>
		{/if}

		{#if error}<InlineNotice class="mt-5" tone="error" message={error} />{/if}

		{#if recording}
			<section class="mt-8 rounded-lg border bg-card p-5" aria-labelledby="recording-active-title">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p id="recording-active-title" class="font-medium">{m.video_editor_record_screen()}</p>
						<p class="mt-1 font-mono text-3xl tabular-nums">
							{durationLabel(recordingState?.elapsed_ms ?? 0)}
						</p>
					</div>
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<span class="size-2 animate-pulse rounded-full bg-destructive"></span>
						{formatBytes(recordingState?.bytes_written ?? 0)}
					</div>
				</div>
				<div class="mt-5 grid gap-2 text-sm sm:grid-cols-3">
					<div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
						<CameraIcon class="size-4" />
						{recordingState?.camera_active
							? m.video_editor_status_enabled()
							: m.video_editor_status_disabled()}
					</div>
					<div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
						<MicIcon class="size-4" />
						{recordingState?.microphone_active
							? m.video_editor_status_enabled()
							: m.video_editor_status_disabled()}
					</div>
					<div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
						<VolumeIcon class="size-4" />
						{recordingState?.system_audio_active
							? m.video_editor_status_enabled()
							: m.video_editor_status_disabled()}
					</div>
				</div>
				{#if recordingState?.camera_active || recordingState?.microphone_active}
					<div class="mt-5 grid gap-3 sm:grid-cols-2">
						{#if recordingState.camera_active}
							<label class="grid gap-1.5 text-sm">
								<span class="font-medium">{m.video_editor_switch_camera()}</span>
								<AppSelect
									value={cameraDeviceID}
									disabled={switchingDevice !== null}
									ariaLabel={m.video_editor_switch_camera()}
									onValueChange={(value) => void switchRecordingInput('camera', value)}
									options={availableDevices
										.filter((device) => device.kind === 'videoinput' && device.deviceId)
										.map((device, index) => ({
											value: device.deviceId,
											label: device.label || m.video_editor_camera_number({ number: index + 1 })
										}))}
								/>
							</label>
						{/if}
						{#if recordingState.microphone_active}
							<label class="grid gap-1.5 text-sm">
								<span class="font-medium">{m.video_editor_switch_microphone()}</span>
								<AppSelect
									value={microphoneDeviceID}
									disabled={switchingDevice !== null}
									ariaLabel={m.video_editor_switch_microphone()}
									onValueChange={(value) => void switchRecordingInput('microphone', value)}
									options={availableDevices
										.filter((device) => device.kind === 'audioinput' && device.deviceId)
										.map((device, index) => ({
											value: device.deviceId,
											label: device.label || m.video_editor_microphone_number({ number: index + 1 })
										}))}
								/>
							</label>
						{/if}
					</div>
				{/if}
				<div class="mt-6 flex justify-end">
					<Button
						variant="destructive"
						disabled={creating || switchingDevice !== null}
						onclick={stopRecording}
					>
						{#if switchingDevice}<LoaderIcon class="size-4 animate-spin" />{/if}
						{#if creating}<LoaderIcon class="size-4 animate-spin" />{/if}
						{m.video_editor_recording_stop()}
					</Button>
				</div>
			</section>
		{:else if mode === 'record'}
			<section class="mt-8 border-y py-6" aria-labelledby="recording-setup-title">
				<div class="grid gap-8 md:grid-cols-[minmax(0,1fr)_18rem]">
					<div>
						<div class="flex items-center gap-2">
							<MonitorIcon class="size-5 text-primary" />
							<h2 id="recording-setup-title" class="text-lg font-semibold">
								{m.video_editor_recording_setup()}
							</h2>
						</div>
						<p class="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
							{m.video_editor_record_screen_description()}
						</p>
						<InlineNotice class="mt-4" tone="info" message={m.video_editor_system_audio_note()} />
					</div>
					<div class="space-y-4">
						<label class="flex min-h-11 items-center gap-3 text-sm">
							<Checkbox bind:checked={camera} />
							<CameraIcon class="size-4 text-muted-foreground" />
							{m.video_editor_camera()}
						</label>
						<label class="flex min-h-11 items-center gap-3 text-sm">
							<Checkbox bind:checked={microphone} />
							<MicIcon class="size-4 text-muted-foreground" />
							{m.video_editor_microphone()}
						</label>
						<label class="flex min-h-11 items-center gap-3 text-sm">
							<Checkbox bind:checked={systemAudio} />
							<VolumeIcon class="size-4 text-muted-foreground" />
							{m.video_editor_system_audio_note()}
						</label>
						{#if camera}
							<label class="grid gap-1.5 text-sm">
								<span class="font-medium">{m.video_editor_camera()}</span>
								<AppSelect
									value={cameraDeviceID}
									onValueChange={(value) => (cameraDeviceID = value)}
									options={[
										{ value: '', label: m.video_editor_device_default() },
										...availableDevices
											.filter((device) => device.kind === 'videoinput')
											.map((device, index) => ({
												value: device.deviceId,
												label: device.label || m.video_editor_camera_number({ number: index + 1 })
											}))
									]}
								/>
							</label>
							<label class="grid gap-1.5 text-sm">
								<span class="font-medium">{m.video_editor_camera_layout()}</span>
								<AppSelect
									value={cameraLayout}
									onValueChange={(value) => (cameraLayout = value as typeof cameraLayout)}
									options={[
										{ value: 'circle', label: m.video_editor_camera_circle() },
										{ value: 'rounded', label: m.video_editor_camera_rounded() },
										{ value: 'portrait', label: m.video_editor_camera_portrait() },
										{ value: 'side-by-side', label: m.video_editor_camera_side_by_side() },
										{ value: 'full', label: m.video_editor_camera_full() }
									]}
								/>
							</label>
						{/if}
						{#if microphone}
							<label class="grid gap-1.5 text-sm">
								<span class="font-medium">{m.video_editor_microphone()}</span>
								<AppSelect
									value={microphoneDeviceID}
									onValueChange={(value) => (microphoneDeviceID = value)}
									options={[
										{ value: '', label: m.video_editor_device_default() },
										...availableDevices
											.filter((device) => device.kind === 'audioinput')
											.map((device, index) => ({
												value: device.deviceId,
												label:
													device.label || m.video_editor_microphone_number({ number: index + 1 })
											}))
									]}
								/>
							</label>
						{/if}
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1.5 text-sm">
								<span class="font-medium">{m.video_editor_record_countdown()}</span>
								<AppSelect
									value={String(countdownSeconds)}
									onValueChange={(value) => (countdownSeconds = Number(value) as 0 | 3 | 5)}
									options={[
										{ value: '0', label: m.video_editor_record_countdown_off() },
										{ value: '3', label: m.video_editor_record_seconds({ seconds: 3 }) },
										{ value: '5', label: m.video_editor_record_seconds({ seconds: 5 }) }
									]}
								/>
							</label>
							<label class="grid gap-1.5 text-sm">
								<span class="font-medium">{m.video_editor_record_planned()}</span>
								<AppSelect
									value={String(plannedMinutes)}
									onValueChange={(value) => (plannedMinutes = Number(value) as 5 | 10 | 20)}
									options={[5, 10, 20].map((minutes) => ({
										value: String(minutes),
										label: m.video_editor_record_minutes({ minutes })
									}))}
								/>
							</label>
						</div>
						<p class="text-xs leading-5 text-muted-foreground">
							{m.video_editor_record_estimate({
								size: formatBytes(estimatedRecordingBytes)
							})}
						</p>
						<Button class="w-full" disabled={creating || !entryReady} onclick={startRecording}>
							{#if creating}<LoaderIcon class="size-4 animate-spin" />{/if}
							{countdownRemaining > 0
								? m.video_editor_record_countdown_active({ seconds: countdownRemaining })
								: m.video_editor_recording_start()}
						</Button>
					</div>
				</div>
			</section>
		{:else if mode === 'stock'}
			<section class="mt-8 border-y py-6">
				{#if entryReady}
					<StockMediaBrowser accept="both" onSelect={addStock} />
				{:else}
					<div class="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
						<LoaderIcon class="mr-2 size-4 animate-spin" />
						{m.common_loading()}
					</div>
				{/if}
			</section>
		{:else}
			<section class="mt-8 space-y-5">
				<div
					role="region"
					aria-label={m.video_editor_drop()}
					class={[
						'flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center transition-colors',
						dragging && 'border-primary bg-primary/5'
					]}
					ondragenter={(event) => {
						event.preventDefault();
						dragging = true;
					}}
					ondragover={(event) => event.preventDefault()}
					ondragleave={(event) => {
						if (event.currentTarget === event.target) dragging = false;
					}}
					ondrop={(event) => {
						event.preventDefault();
						dragging = false;
						void createFromFiles(Array.from(event.dataTransfer?.files ?? []));
					}}
				>
					<FileVideoIcon class="size-7 text-primary" />
					<h2 class="mt-4 font-medium">{m.video_editor_drop()}</h2>
					<p class="mt-1 max-w-md text-sm text-muted-foreground">
						{editingMode === 'quick-cut'
							? m.video_editor_quick_file_hint()
							: m.video_editor_file_hint()}
					</p>
					<Button class="mt-5" disabled={creating || !entryReady} onclick={triggerFilePicker}>
						{#if creating}<LoaderIcon class="size-4 animate-spin" />{/if}
						{m.video_editor_choose_files()}
					</Button>
					<Input
						id="video-editor-new-files"
						type="file"
						multiple={editingMode === 'editor'}
						accept={editingMode === 'quick-cut'
							? 'video/*'
							: 'video/*,audio/*,image/jpeg,image/png,image/webp,image/gif'}
						class="sr-only !size-px !p-0"
						onchange={chooseFiles}
					/>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<a
						href={resolve('/video-editor/new?mode=record' as '/')}
						aria-disabled={!entryReady}
						tabindex={entryReady ? undefined : -1}
						class="flex min-h-24 items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
						onclick={(event) => {
							if (!entryReady) event.preventDefault();
						}}
					>
						<MonitorIcon class="size-5 text-primary" />
						<span>
							<span class="block font-medium">{m.video_editor_record_screen()}</span>
							<span class="mt-1 block text-sm text-muted-foreground"
								>{m.video_editor_record_screen_description()}</span
							>
						</span>
					</a>
					<button
						type="button"
						class="flex min-h-24 items-center gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						disabled={creating || !entryReady}
						onclick={createBlank}
					>
						<PlusIcon class="size-5 text-primary" />
						<span>
							<span class="block font-medium">{m.video_editor_blank()}</span>
							<span class="mt-1 block text-sm text-muted-foreground"
								>{m.video_editor_blank_description()}</span
							>
						</span>
					</button>
				</div>
			</section>
		{/if}
	</main>
</div>
