<!--
THESIS: Video Studio starts as a trustworthy local workbench, not an account funnel.
OWN-WORLD: OpenPost warm neutrals, compact Geist controls, structural borders, and one scarce orange action signal.
STORY: Import or record, reopen resilient local work, then choose when cloud save or composer handoff matters.
FIRST VIEWPORT: A direct privacy promise, import action, recording option, storage truth, and recent work for returning creators.
FORM: Operate surface extending OpenPost Studio; no watermark pitch, decorative hero effects, or automatic upload.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import { detectVideoStudioCapabilities } from '$lib/video-studio/capabilities';
	import {
		getCloudVideoProject,
		listCloudVideoProjects,
		loadVideoStudioConfig,
		type CloudVideoProjectSummary
	} from '$lib/video-studio/api';
	import {
		deleteLocalVideoProject,
		estimateStorageBudget,
		createLocalVideoProject,
		listLocalVideoProjects,
		persistentVideoStorageState,
		requestPersistentVideoStorage,
		saveLocalVideoProject
	} from '$lib/video-studio/storage';
	import type { VideoProjectDocumentV1 } from '@openpost/video-project';
	import { createLocalVideoProjectFromFiles, formatBytes } from '$lib/video-studio/project';
	import type { LocalVideoProject, VideoStudioCapabilities } from '$lib/video-studio/types';
	import CameraIcon from 'lucide-svelte/icons/video';
	import CloudIcon from 'lucide-svelte/icons/cloud';
	import FolderIcon from 'lucide-svelte/icons/folder-open';
	import HardDriveIcon from 'lucide-svelte/icons/hard-drive';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import ShieldIcon from 'lucide-svelte/icons/shield-check';
	import SparklesIcon from 'lucide-svelte/icons/sparkles';
	import TrashIcon from 'lucide-svelte/icons/trash-2';

	let authState = $derived($auth);
	let loading = $state(true);
	let creating = $state(false);
	let enabled = $state(true);
	let error = $state('');
	let recentProjects = $state.raw<LocalVideoProject[]>([]);
	let capabilities = $state<VideoStudioCapabilities | null>(null);
	let persistentStorage = $state<boolean | undefined>(undefined);
	let storageLabel = $state('');
	let pendingDelete = $state<LocalVideoProject | null>(null);
	let deleteDialogOpen = $state(false);
	let cloudProjects = $state.raw<CloudVideoProjectSummary[]>([]);
	let openingCloudID = $state('');

	onMount(() => {
		void initialize();
	});

	async function initialize(): Promise<void> {
		loading = true;
		error = '';
		try {
			await auth.initialize({ optional: true });
			const [config, localProjects, detected, persisted, storage] = await Promise.all([
				loadVideoStudioConfig(),
				listLocalVideoProjects(),
				detectVideoStudioCapabilities(),
				persistentVideoStorageState(),
				estimateStorageBudget(0)
			]);
			enabled = config.enabled;
			recentProjects = localProjects;
			capabilities = detected;
			persistentStorage = persisted;
			storageLabel =
				storage.quota_bytes > 0
					? m.video_studio_storage_estimate({
							used: formatBytes(storage.usage_bytes),
							quota: formatBytes(storage.quota_bytes)
						})
					: m.video_studio_storage_unknown();
			if ($auth.isAuthenticated) {
				await workspaceCtx.initialize();
				const workspaceID = workspaceCtx.currentWorkspace?.id;
				if (workspaceID) {
					const cloud = await listCloudVideoProjects(workspaceID);
					const mirrored = new Set(localProjects.map((project) => project.cloud_project_id));
					cloudProjects = cloud.projects.filter((project) => !mirrored.has(project.id));
				}
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_load_failed();
		} finally {
			loading = false;
		}
	}

	async function openFiles(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length === 0 || creating) return;
		creating = true;
		error = '';
		try {
			const project = await createLocalVideoProjectFromFiles(files);
			await goto(resolve(`/video-studio/${project.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_create_failed();
			creating = false;
		}
	}

	async function protectStorage(): Promise<void> {
		persistentStorage = await requestPersistentVideoStorage();
	}

	function requestDelete(project: LocalVideoProject): void {
		pendingDelete = project;
		deleteDialogOpen = true;
	}

	async function confirmDelete(): Promise<void> {
		if (!pendingDelete) return;
		await deleteLocalVideoProject(pendingDelete.id);
		recentProjects = recentProjects.filter((project) => project.id !== pendingDelete?.id);
		pendingDelete = null;
	}

	function projectDuration(project: LocalVideoProject): string {
		const durationUS = project.document.primary_sequence.reduce((total, clip) => {
			if (clip.mode === 'freeze') return total + (clip.freeze_duration_us ?? 0);
			return total + Math.max(0, (clip.source_out_us - clip.source_in_us) / clip.speed);
		}, 0);
		const seconds = Math.round(durationUS / 1_000_000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function chooseFiles(): void {
		document.querySelector<HTMLInputElement>('#video-studio-import')?.click();
	}

	async function openCloudProject(projectID: string): Promise<void> {
		if (openingCloudID) return;
		openingCloudID = projectID;
		error = '';
		try {
			const response = await getCloudVideoProject(projectID);
			const created = await createLocalVideoProject(
				`local_video_${crypto.randomUUID()}`,
				response.document as unknown as VideoProjectDocumentV1
			);
			const mirrored = await saveLocalVideoProject({
				...created,
				cloud_project_id: response.id,
				cloud_revision: response.revision,
				state: 'cloud'
			});
			await goto(resolve(`/video-studio/${mirrored.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_load_failed();
			openingCloudID = '';
		}
	}
</script>

<svelte:head>
	<title>{m.video_studio_meta_title()}</title>
	<meta name="description" content={m.video_studio_meta_description()} />
</svelte:head>

<div class="video-studio-theme min-h-dvh bg-background text-foreground">
	<header class="border-b bg-background">
		<div class="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
			<a href={resolve('/')} class="flex min-h-11 items-center" aria-label={m.common_openpost()}>
				<Logo width={112} height={33} />
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">/ {m.video_studio_title()}</span>
			<div class="ml-auto flex items-center gap-1.5">
				<LanguageSwitcher compact />
				{#if authState.isAuthenticated}
					<Button href="/media" variant="outline" size="sm">
						{m.video_studio_openpost_media()}
					</Button>
				{:else}
					<Button href="/login?redirect=%2Fvideo-studio" variant="ghost" size="sm">
						{m.landing_sign_in()}
					</Button>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
		<div class="max-w-3xl">
			<p class="text-sm font-medium text-primary">{m.video_studio_free_tool()}</p>
			<h1 class="mt-2 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
				{m.video_studio_heading()}
			</h1>
			<p class="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
				{m.video_studio_intro()}
			</p>
			<div class="mt-4 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
				<ShieldIcon class="mt-1 size-4 shrink-0 text-primary" />
				<p>{m.video_studio_privacy()}</p>
			</div>
		</div>

		{#if loading}
			<div class="mt-10 flex items-center gap-2 text-sm text-muted-foreground" role="status">
				<LoaderIcon class="size-4 animate-spin" />
				{m.video_studio_loading()}
			</div>
		{:else}
			<div class="mt-8 space-y-4">
				{#if error}<InlineNotice tone="error" message={error} />{/if}
				{#if !enabled}<InlineNotice tone="warning" message={m.video_studio_disabled()} />{/if}
				{#if capabilities && (!capabilities.supported || !capabilities.desktopTimeline)}
					<InlineNotice tone="warning">
						<div class="space-y-1">
							<p class="font-medium">{m.video_studio_unsupported()}</p>
							<p class="text-current/80">
								{capabilities.desktopTimeline
									? m.video_studio_unsupported_body()
									: m.video_studio_unsupported_mobile()}
							</p>
							<a
								href={resolve('/video-studio/unsupported')}
								class="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
							>
								{m.video_studio_capability_details()}
							</a>
						</div>
					</InlineNotice>
				{/if}
			</div>

			<section class="mt-8 border-y py-6" aria-labelledby="video-start-heading">
				<h2 id="video-start-heading" class="sr-only">{m.video_studio_new_heading()}</h2>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<button
						type="button"
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
						disabled={!enabled || creating || !capabilities?.supported}
						onclick={chooseFiles}
					>
						<FolderIcon class="size-5 text-primary" />
						<span class="mt-8 block font-medium">{m.video_studio_import()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_studio_file_hint()}</span
						>
					</button>
					<a
						href={enabled && capabilities?.supported
							? resolve('/video-studio/new?mode=record' as '/')
							: undefined}
						aria-disabled={!enabled || !capabilities?.supported}
						tabindex={!enabled || !capabilities?.supported ? -1 : undefined}
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
					>
						<CameraIcon class="size-5 text-foreground" />
						<span class="mt-8 block font-medium">{m.video_studio_record()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_studio_record_screen_description()}</span
						>
					</a>
					<a
						href={enabled && capabilities?.supported
							? resolve('/video-studio/new?mode=stock' as '/')
							: undefined}
						aria-disabled={!enabled || !capabilities?.supported}
						tabindex={!enabled || !capabilities?.supported ? -1 : undefined}
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
					>
						<SparklesIcon class="size-5 text-foreground" />
						<span class="mt-8 block font-medium">{m.video_studio_stock()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_studio_stock_description()}</span
						>
					</a>
					<a
						href={enabled && capabilities?.supported
							? resolve('/video-studio/new?mode=blank' as '/')
							: undefined}
						aria-disabled={!enabled || !capabilities?.supported}
						tabindex={!enabled || !capabilities?.supported ? -1 : undefined}
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
					>
						<PlusIcon class="size-5 text-foreground" />
						<span class="mt-8 block font-medium">{m.video_studio_blank()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_studio_blank_description()}</span
						>
					</a>
				</div>
				<Input
					id="video-studio-import"
					type="file"
					multiple
					accept="video/*,audio/*,image/jpeg,image/png,image/webp,image/gif"
					class="sr-only !size-px !p-0"
					onchange={openFiles}
				/>
			</section>

			<section class="mt-8" aria-labelledby="storage-heading">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 id="storage-heading" class="text-base font-semibold">{m.video_studio_storage()}</h2>
						<p class="mt-1 text-sm text-muted-foreground">{storageLabel}</p>
					</div>
					<div class="flex items-center gap-2">
						<HardDriveIcon class="size-4 text-muted-foreground" />
						<span class="text-sm">
							{persistentStorage
								? m.video_studio_storage_persistent()
								: m.video_studio_storage_not_persistent()}
						</span>
						{#if persistentStorage === false || persistentStorage === undefined}
							<Button variant="outline" size="sm" onclick={protectStorage}>
								{m.video_studio_storage_request()}
							</Button>
						{/if}
					</div>
				</div>
			</section>

			<section class="mt-10" aria-labelledby="recent-heading">
				<div>
					<h2 id="recent-heading" class="text-lg font-semibold">{m.video_studio_recent()}</h2>
					<p class="mt-1 text-sm text-muted-foreground">{m.video_studio_recent_description()}</p>
				</div>
				{#if recentProjects.length === 0}
					<div
						class="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
					>
						{m.video_studio_no_recent()}
					</div>
				{:else}
					<div class="mt-4 divide-y rounded-lg border">
						{#each recentProjects as project (project.id)}
							<div class="flex min-w-0 items-center gap-4 p-3 sm:p-4">
								<div
									class="flex aspect-video w-24 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-zinc-500"
									aria-hidden="true"
								>
									<CameraIcon class="size-5" />
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate font-medium">{project.document.title}</p>
									<div
										class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
									>
										<span class="font-mono">{projectDuration(project)}</span>
										<span>
											{project.state === 'cloud'
												? m.video_studio_saved_cloud()
												: m.video_studio_local_only()}
										</span>
										{#if project.state === 'cloud'}<CloudIcon class="size-3.5" />{/if}
									</div>
								</div>
								<div class="flex shrink-0 items-center gap-1">
									<Button href={`/video-studio/${project.id}`} variant="outline" size="sm">
										{m.video_studio_open_project()}
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										onclick={() => requestDelete(project)}
										aria-label={m.video_studio_delete_project()}
									>
										<TrashIcon class="size-4" />
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			{#if authState.isAuthenticated}
				<section class="mt-10" aria-labelledby="cloud-heading">
					<div>
						<h2 id="cloud-heading" class="text-lg font-semibold">
							{m.video_studio_cloud_projects()}
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{m.video_studio_cloud_projects_description()}
						</p>
					</div>
					{#if cloudProjects.length === 0}
						<div
							class="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
						>
							{m.video_studio_cloud_empty()}
						</div>
					{:else}
						<div class="mt-4 divide-y rounded-lg border">
							{#each cloudProjects as project (project.id)}
								<div class="flex items-center gap-4 p-3 sm:p-4">
									<div
										class="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted"
									>
										<CloudIcon class="size-4 text-muted-foreground" />
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate font-medium">{project.title}</p>
										<p class="mt-1 text-xs text-muted-foreground">
											{m.video_studio_sources_count({ count: project.source_count })}
										</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										disabled={Boolean(openingCloudID)}
										onclick={() => void openCloudProject(project.id)}
									>
										{#if openingCloudID === project.id}
											<LoaderIcon class="size-4 animate-spin" />
											{m.video_studio_opening_cloud()}
										{:else}
											{m.video_studio_open_project()}
										{/if}
									</Button>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}
		{/if}
	</main>
</div>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.video_studio_delete_title()}
	description={m.video_studio_delete_body()}
	onConfirm={confirmDelete}
/>
