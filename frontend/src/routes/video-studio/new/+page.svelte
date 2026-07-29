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
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import { loadVideoStudioConfig, type StockAsset } from '$lib/video-studio/api';
	import { m } from '$lib/paraglide/messages';
	import { detectVideoStudioCapabilities } from '$lib/video-studio/capabilities';
	import {
		addFileToProject,
		addRecordingToProject,
		createBlankLocalVideoProject,
		createLocalVideoProjectFromFiles,
		formatBytes
	} from '$lib/video-studio/project';
	import { VideoRecordingSession, type RecordingSessionState } from '$lib/video-studio/recorder';
	import {
		deleteRecording,
		deleteLocalVideoProject,
		estimateStorageBudget,
		requestPersistentVideoStorage,
		saveLocalVideoProject
	} from '$lib/video-studio/storage';
	import type { LocalVideoProject } from '$lib/video-studio/types';
	import ArrowLeftIcon from 'lucide-svelte/icons/arrow-left';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import FileVideoIcon from 'lucide-svelte/icons/file-video';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import MicIcon from 'lucide-svelte/icons/mic';
	import MonitorIcon from 'lucide-svelte/icons/monitor-up';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import VolumeIcon from 'lucide-svelte/icons/volume-2';

	let mode = $derived($page.url.searchParams.get('mode') ?? 'import');
	let error = $state('');
	let creating = $state(false);
	let dragging = $state(false);
	let camera = $state(true);
	let microphone = $state(true);
	let systemAudio = $state(true);
	let recording = $state<VideoRecordingSession | null>(null);
	let recordingProject = $state<LocalVideoProject | null>(null);
	let recordingState = $state<RecordingSessionState | null>(null);
	let entryReady = $state(false);

	onMount(() => {
		void initializeEntry();
	});

	async function initializeEntry(): Promise<void> {
		const [config, capabilities] = await Promise.all([
			loadVideoStudioConfig(),
			detectVideoStudioCapabilities()
		]);
		if (!config.enabled) {
			await goto(resolve('/video-studio' as '/'), { replaceState: true });
			return;
		}
		if (!capabilities.supported) {
			await goto(resolve('/video-studio/unsupported' as '/'), { replaceState: true });
			return;
		}
		entryReady = true;
		const mediaID = $page.url.searchParams.get('source_media');
		if (mediaID) await createFromOpenPostMedia(mediaID);
	}

	async function createFromOpenPostMedia(mediaID: string): Promise<void> {
		if (creating) return;
		creating = true;
		error = '';
		try {
			const response = await fetch(getAuthenticatedMediaByID(mediaID), {
				credentials: 'include'
			});
			if (!response.ok) throw new Error(m.media_read_failed());
			const blob = await response.blob();
			const name =
				$page.url.searchParams.get('source_name') ||
				`openpost-media-${mediaID}.${blob.type.startsWith('video/') ? 'mp4' : 'bin'}`;
			const project = await createLocalVideoProjectFromFiles([
				new File([blob], name, { type: blob.type, lastModified: Date.now() })
			]);
			await openProject(project.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_create_failed();
			creating = false;
		}
	}

	async function createFromFiles(files: File[]): Promise<void> {
		if (files.length === 0 || creating) return;
		creating = true;
		error = '';
		try {
			void requestPersistentVideoStorage();
			const project = await createLocalVideoProjectFromFiles(files);
			await openProject(project.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_create_failed();
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
			error = cause instanceof Error ? cause.message : m.video_studio_create_failed();
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
			const budget = await estimateStorageBudget(200 * 1024 * 1024);
			if (!budget.can_continue) {
				throw new Error(
					m.video_studio_recording_space({ available: formatBytes(budget.available_bytes) })
				);
			}
			project = await createBlankLocalVideoProject('Screen recording');
			recordingProject = project;
			recording = await VideoRecordingSession.start({
				projectID: project.id,
				camera,
				microphone,
				systemAudio,
				onState: (state) => (recordingState = state)
			});
		} catch (cause) {
			if (project) await deleteLocalVideoProject(project.id);
			recordingProject = null;
			error =
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? m.video_studio_recording_cancelled()
					: cause instanceof Error
						? cause.message
						: m.video_studio_create_failed();
		} finally {
			creating = false;
		}
	}

	async function stopRecording(): Promise<void> {
		if (!recording || !recordingProject || creating) return;
		creating = true;
		try {
			const manifest = await recording.stop();
			await addRecordingToProject(recordingProject, manifest);
			const saved = await saveLocalVideoProject(recordingProject);
			await deleteRecording(manifest);
			await openProject(saved.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_create_failed();
			creating = false;
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
			error = cause instanceof Error ? cause.message : m.video_studio_create_failed();
			creating = false;
		}
	}

	async function openProject(id: string): Promise<void> {
		const query = new URLSearchParams();
		for (const key of ['return_token', 'required_variants', 'variant_renditions']) {
			const value = $page.url.searchParams.get(key);
			if (value) query.set(key, value);
		}
		await goto(resolve(`/video-studio/${id}${query.size ? `?${query.toString()}` : ''}` as '/'), {
			replaceState: true
		});
	}

	function triggerFilePicker(): void {
		document.querySelector<HTMLInputElement>('#video-studio-new-files')?.click();
	}

	function durationLabel(milliseconds: number): string {
		const seconds = Math.floor(milliseconds / 1_000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>{m.video_studio_new_meta_title()}</title>
</svelte:head>

<div class="video-studio-theme min-h-dvh bg-background text-foreground">
	<header class="border-b">
		<div class="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
			<a href={resolve('/')} class="flex min-h-11 items-center" aria-label={m.common_openpost()}>
				<Logo width={112} height={33} />
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">/ {m.video_studio_title()}</span>
			<div class="ml-auto"><LanguageSwitcher compact /></div>
		</div>
	</header>

	<main class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
		<Button href="/video-studio" variant="ghost" size="sm" class="-ml-2">
			<ArrowLeftIcon class="size-4" />
			{m.video_studio_back()}
		</Button>

		<div class="mt-5 max-w-2xl">
			<h1 class="text-2xl font-semibold tracking-tight">{m.video_studio_new_heading()}</h1>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">{m.video_studio_new_intro()}</p>
		</div>

		{#if error}<InlineNotice class="mt-5" tone="error" message={error} />{/if}

		{#if recording}
			<section class="mt-8 rounded-lg border bg-card p-5" aria-labelledby="recording-active-title">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<p id="recording-active-title" class="font-medium">{m.video_studio_record_screen()}</p>
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
							? m.video_studio_status_enabled()
							: m.video_studio_status_disabled()}
					</div>
					<div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
						<MicIcon class="size-4" />
						{recordingState?.microphone_active
							? m.video_studio_status_enabled()
							: m.video_studio_status_disabled()}
					</div>
					<div class="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
						<VolumeIcon class="size-4" />
						{recordingState?.system_audio_active
							? m.video_studio_status_enabled()
							: m.video_studio_status_disabled()}
					</div>
				</div>
				<div class="mt-6 flex justify-end">
					<Button variant="destructive" disabled={creating} onclick={stopRecording}>
						{#if creating}<LoaderIcon class="size-4 animate-spin" />{/if}
						{m.video_studio_recording_stop()}
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
								{m.video_studio_recording_setup()}
							</h2>
						</div>
						<p class="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
							{m.video_studio_record_screen_description()}
						</p>
						<InlineNotice class="mt-4" tone="info" message={m.video_studio_system_audio_note()} />
					</div>
					<div class="space-y-4">
						<label class="flex min-h-11 items-center gap-3 text-sm">
							<Checkbox bind:checked={camera} />
							<CameraIcon class="size-4 text-muted-foreground" />
							{m.video_studio_camera()}
						</label>
						<label class="flex min-h-11 items-center gap-3 text-sm">
							<Checkbox bind:checked={microphone} />
							<MicIcon class="size-4 text-muted-foreground" />
							{m.video_studio_microphone()}
						</label>
						<label class="flex min-h-11 items-center gap-3 text-sm">
							<Checkbox bind:checked={systemAudio} />
							<VolumeIcon class="size-4 text-muted-foreground" />
							{m.video_studio_system_audio_note()}
						</label>
						<Button class="w-full" disabled={creating || !entryReady} onclick={startRecording}>
							{#if creating}<LoaderIcon class="size-4 animate-spin" />{/if}
							{m.video_studio_recording_start()}
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
					aria-label={m.video_studio_drop()}
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
					<h2 class="mt-4 font-medium">{m.video_studio_drop()}</h2>
					<p class="mt-1 max-w-md text-sm text-muted-foreground">{m.video_studio_file_hint()}</p>
					<Button class="mt-5" disabled={creating || !entryReady} onclick={triggerFilePicker}>
						{#if creating}<LoaderIcon class="size-4 animate-spin" />{/if}
						{m.video_studio_choose_files()}
					</Button>
					<Input
						id="video-studio-new-files"
						type="file"
						multiple
						accept="video/*,audio/*,image/jpeg,image/png,image/webp,image/gif"
						class="sr-only !size-px !p-0"
						onchange={chooseFiles}
					/>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<a
						href={resolve('/video-studio/new?mode=record' as '/')}
						aria-disabled={!entryReady}
						tabindex={entryReady ? undefined : -1}
						class="flex min-h-24 items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
						onclick={(event) => {
							if (!entryReady) event.preventDefault();
						}}
					>
						<MonitorIcon class="size-5 text-primary" />
						<span>
							<span class="block font-medium">{m.video_studio_record_screen()}</span>
							<span class="mt-1 block text-sm text-muted-foreground"
								>{m.video_studio_record_screen_description()}</span
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
							<span class="block font-medium">{m.video_studio_blank()}</span>
							<span class="mt-1 block text-sm text-muted-foreground"
								>{m.video_studio_blank_description()}</span
							>
						</span>
					</button>
				</div>
			</section>
		{/if}
	</main>
</div>
