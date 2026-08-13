<!--
THESIS: OpenPost Video Editor starts as a trustworthy local workbench, not an account funnel.
OWN-WORLD: OpenPost warm neutrals, compact Geist controls, structural borders, and one scarce orange action signal.
STORY: Import or record, reopen resilient local work, then choose when cloud save or composer handoff matters.
FIRST VIEWPORT: A direct privacy promise, import action, recording option, storage truth, and recent work for returning creators.
FORM: Operate surface extending the OpenPost Video Editor start screen; no watermark pitch, decorative hero effects, or automatic upload.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
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
	import { detectVideoEditorCapabilities } from '$lib/video-editor/capabilities';
	import {
		getCloudVideoProject,
		listCloudVideoProjects,
		loadVideoEditorConfig,
		type CloudVideoProjectSummary
	} from '$lib/video-editor/api';
	import {
		deleteLocalVideoProject,
		estimateStorageBudget,
		createLocalVideoProject,
		listLocalVideoProjects,
		persistentVideoStorageState,
		requestPersistentVideoStorage,
		saveLocalVideoProject
	} from '$lib/video-editor/storage';
	import {
		defaultCaptionStyle,
		projectDurationUS,
		type CaptionStyle,
		type VideoProjectDocumentV1
	} from '@openpost/video-project';
	import {
		createBlankLocalVideoProject,
		cloudVideoSourceIDForMedia,
		createLocalVideoProjectFromFiles,
		formatBytes
	} from '$lib/video-editor/project';
	import type { LocalVideoProject, VideoEditorCapabilities } from '$lib/video-editor/types';
	import CameraIcon from '@lucide/svelte/icons/video';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import FolderIcon from '@lucide/svelte/icons/folder-open';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ShieldIcon from '@lucide/svelte/icons/shield-check';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	let authState = $derived($auth);
	let loading = $state(true);
	let creating = $state(false);
	let enabled = $state(true);
	let error = $state('');
	let recentProjects = $state.raw<LocalVideoProject[]>([]);
	let capabilities = $state<VideoEditorCapabilities | null>(null);
	let persistentStorage = $state<boolean | undefined>(undefined);
	let storageLabel = $state('');
	let storageRequesting = $state(false);
	let storageMessage = $state('');
	let storageMessageTone = $state<'success' | 'warning'>('success');
	let pendingDelete = $state<LocalVideoProject | null>(null);
	let deleteDialogOpen = $state(false);
	let cloudProjects = $state.raw<CloudVideoProjectSummary[]>([]);
	let openingCloudID = $state('');
	type TemplateID = 'clean-captions' | 'product-demo' | 'talking-head' | 'announcement';
	const templates: Array<{
		id: TemplateID;
		name: () => string;
		description: () => string;
	}> = [
		{
			id: 'clean-captions',
			name: () => m.video_editor_template_clean(),
			description: () => m.video_editor_template_clean_description()
		},
		{
			id: 'product-demo',
			name: () => m.video_editor_template_product(),
			description: () => m.video_editor_template_product_description()
		},
		{
			id: 'talking-head',
			name: () => m.video_editor_template_talking(),
			description: () => m.video_editor_template_talking_description()
		},
		{
			id: 'announcement',
			name: () => m.video_editor_template_announcement(),
			description: () => m.video_editor_template_announcement_description()
		}
	];

	onMount(() => {
		void initialize();
	});

	async function initialize(): Promise<void> {
		loading = true;
		error = '';
		try {
			await auth.initialize({ optional: true });
			const [config, localProjects, detected, persisted, storage] = await Promise.all([
				loadVideoEditorConfig(),
				listLocalVideoProjects(),
				detectVideoEditorCapabilities(),
				persistentVideoStorageState(),
				estimateStorageBudget(0)
			]);
			enabled = config.enabled;
			recentProjects = localProjects;
			capabilities = detected;
			persistentStorage = persisted;
			storageLabel =
				storage.quota_bytes > 0
					? m.video_editor_storage_estimate({
							used: formatBytes(storage.usage_bytes),
							quota: formatBytes(storage.quota_bytes)
						})
					: m.video_editor_storage_unknown();
			if ($auth.isAuthenticated) {
				await workspaceCtx.initialize();
				const workspaceID = workspaceCtx.currentWorkspace?.id;
				if (workspaceID) {
					const cloud = await listCloudVideoProjects(workspaceID);
					const mirrored = new Set(localProjects.map((project) => project.cloud_project_id));
					cloudProjects = cloud.projects.filter((project) => !mirrored.has(project.id));
					const requestedCloudProject = page.url.searchParams.get('cloud');
					if (requestedCloudProject) await openCloudProject(requestedCloudProject);
				}
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_load_failed();
		} finally {
			loading = false;
		}
	}

	async function openFiles(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!enabled || !capabilities?.supported || files.length === 0 || creating) return;
		creating = true;
		error = '';
		try {
			const project = await createLocalVideoProjectFromFiles(files);
			await goto(resolve(`/video-editor/${project.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_create_failed();
			creating = false;
		}
	}

	async function protectStorage(): Promise<void> {
		if (storageRequesting) return;
		storageRequesting = true;
		storageMessage = '';
		try {
			persistentStorage = await requestPersistentVideoStorage();
			storageMessageTone = persistentStorage ? 'success' : 'warning';
			storageMessage = persistentStorage
				? m.video_editor_storage_granted()
				: m.video_editor_storage_denied();
		} finally {
			storageRequesting = false;
		}
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
		const durationUS = projectDurationUS(project.document);
		const seconds = Math.round(durationUS / 1_000_000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function chooseFiles(): void {
		if (!enabled || !capabilities?.supported) return;
		document.querySelector<HTMLInputElement>('#video-editor-import')?.click();
	}

	async function openCloudProject(projectID: string): Promise<void> {
		if (!enabled || !capabilities?.supported || openingCloudID) return;
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
				cover_source_id: cloudVideoSourceIDForMedia(
					response.document as unknown as VideoProjectDocumentV1,
					response.cover_preview_media_id
				),
				cloud_cover_preview_media_id: response.cover_preview_media_id || undefined,
				state: 'cloud'
			});
			await goto(resolve(`/video-editor/${mirrored.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_load_failed();
			openingCloudID = '';
		}
	}

	async function createFromTemplate(templateID: TemplateID): Promise<void> {
		if (!enabled || !capabilities?.supported || creating) return;
		creating = true;
		error = '';
		try {
			const name = templates.find((template) => template.id === templateID)?.name() ?? 'Video';
			const project = await createBlankLocalVideoProject(name);
			const style: CaptionStyle = {
				...defaultCaptionStyle(),
				...(templateID === 'product-demo'
					? {
							preset: 'boxed' as const,
							font_size: 52,
							background_color: '#151515e6',
							emphasis_color: '#fb923c'
						}
					: templateID === 'talking-head'
						? {
								preset: 'karaoke' as const,
								font_size: 62,
								background_color: '#00000000',
								emphasis_color: '#f97316'
							}
						: templateID === 'announcement'
							? {
									preset: 'bold' as const,
									font_size: 68,
									font_weight: 800,
									background_color: '#7c2d12e6',
									emphasis_color: '#fed7aa'
								}
							: {})
			};
			project.document.caption_tracks = [
				{
					id: `captions_${crypto.randomUUID()}`,
					name: m.video_editor_tool_captions(),
					language: 'und',
					visible: true,
					style,
					cues: []
				}
			];
			if (templateID === 'product-demo') {
				for (const variant of project.document.variants) variant.background_color = '#f5f1ea';
			}
			if (templateID === 'announcement') {
				for (const variant of project.document.variants) variant.background_color = '#1c1917';
			}
			const saved = await saveLocalVideoProject(project);
			await goto(resolve(`/video-editor/${saved.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_create_failed();
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>{m.video_editor_meta_title()}</title>
	<meta name="description" content={m.video_editor_meta_description()} />
</svelte:head>

<div class="video-editor-theme min-h-dvh bg-background text-foreground">
	<header class="border-b bg-background">
		<div class="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
			<a href={resolve('/')} class="flex min-h-11 items-center" aria-label={m.common_openpost()}>
				<Logo width={112} height={33} />
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">/ {m.video_editor_title()}</span>
			<div class="ml-auto flex items-center gap-1.5">
				<LanguageSwitcher compact />
				{#if authState.isAuthenticated}
					<Button href="/media" variant="outline" size="sm">
						{m.video_editor_openpost_media()}
					</Button>
				{:else}
					<Button href="/login?redirect=%2Fvideo-editor" variant="ghost" size="sm">
						{m.landing_sign_in()}
					</Button>
				{/if}
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
		<div class="max-w-3xl">
			<p class="text-sm font-medium text-primary">{m.video_editor_free_tool()}</p>
			<h1 class="mt-2 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
				{m.video_editor_heading()}
			</h1>
			<p class="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
				{m.video_editor_intro()}
			</p>
			<div class="mt-4 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
				<ShieldIcon class="mt-1 size-4 shrink-0 text-primary" />
				<p>{m.video_editor_privacy()}</p>
			</div>
		</div>

		{#if loading}
			<div class="mt-10 flex items-center gap-2 text-sm text-muted-foreground" role="status">
				<LoaderIcon class="size-4 animate-spin" />
				{m.video_editor_loading()}
			</div>
		{:else}
			<div class="mt-8 space-y-4">
				{#if error}<InlineNotice tone="error" message={error} />{/if}
				{#if !enabled}<InlineNotice tone="warning" message={m.video_editor_disabled()} />{/if}
				{#if capabilities && !capabilities.supported}
					<InlineNotice tone="warning">
						<div class="space-y-1">
							<p class="font-medium">{m.video_editor_unsupported()}</p>
							<p class="text-current/80">{m.video_editor_unsupported_body()}</p>
							<a
								href={resolve('/video-editor/unsupported')}
								class="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
							>
								{m.video_editor_capability_details()}
							</a>
						</div>
					</InlineNotice>
				{:else if capabilities?.editorMode === 'preview'}
					<InlineNotice tone="info" message={m.video_editor_unsupported_mobile()} />
				{/if}
			</div>

			<section class="mt-8 border-y py-6" aria-labelledby="video-start-heading">
				<h2 id="video-start-heading" class="sr-only">{m.video_editor_new_heading()}</h2>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<button
						type="button"
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
						disabled={!enabled || creating || !capabilities?.supported}
						onclick={chooseFiles}
					>
						<FolderIcon class="size-5 text-primary" />
						<span class="mt-8 block font-medium">{m.video_editor_import()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_editor_file_hint()}</span
						>
					</button>
					<a
						href={resolve('/video-editor/new?mode=record' as '/')}
						aria-disabled={!enabled || !capabilities?.supported}
						tabindex={!enabled || !capabilities?.supported ? -1 : undefined}
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
						onclick={(event) => {
							if (!enabled || !capabilities?.supported) event.preventDefault();
						}}
					>
						<CameraIcon class="size-5 text-foreground" />
						<span class="mt-8 block font-medium">{m.video_editor_record()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_editor_record_screen_description()}</span
						>
					</a>
					<a
						href={resolve('/video-editor/new?mode=stock' as '/')}
						aria-disabled={!enabled || !capabilities?.supported}
						tabindex={!enabled || !capabilities?.supported ? -1 : undefined}
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
						onclick={(event) => {
							if (!enabled || !capabilities?.supported) event.preventDefault();
						}}
					>
						<SparklesIcon class="size-5 text-foreground" />
						<span class="mt-8 block font-medium">{m.video_editor_stock()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_editor_stock_description()}</span
						>
					</a>
					<a
						href={resolve('/video-editor/new?mode=blank' as '/')}
						aria-disabled={!enabled || !capabilities?.supported}
						tabindex={!enabled || !capabilities?.supported ? -1 : undefined}
						class="group min-h-36 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
						onclick={(event) => {
							if (!enabled || !capabilities?.supported) event.preventDefault();
						}}
					>
						<PlusIcon class="size-5 text-foreground" />
						<span class="mt-8 block font-medium">{m.video_editor_blank()}</span>
						<span class="mt-1 block text-sm text-muted-foreground"
							>{m.video_editor_blank_description()}</span
						>
					</a>
				</div>
				<Input
					id="video-editor-import"
					type="file"
					multiple
					accept="video/*,audio/*,image/jpeg,image/png,image/webp,image/gif"
					class="sr-only !size-px !p-0"
					aria-hidden="true"
					tabindex={-1}
					onchange={openFiles}
				/>
			</section>

			<section class="mt-8" aria-labelledby="templates-heading">
				<div>
					<h2 id="templates-heading" class="text-lg font-semibold">
						{m.video_editor_templates()}
					</h2>
					<p class="mt-1 text-sm text-muted-foreground">
						{m.video_editor_templates_description()}
					</p>
				</div>
				<div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
					{#each templates as template (template.id)}
						<button
							type="button"
							class="min-h-28 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
							disabled={!enabled || creating || !capabilities?.supported}
							onclick={() => void createFromTemplate(template.id)}
						>
							<span class="block font-medium">{template.name()}</span>
							<span class="mt-2 block text-sm leading-5 text-muted-foreground">
								{template.description()}
							</span>
						</button>
					{/each}
				</div>
			</section>

			<section class="mt-8" aria-labelledby="storage-heading">
				<div class="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 id="storage-heading" class="text-base font-semibold">{m.video_editor_storage()}</h2>
						<p class="mt-1 text-sm text-muted-foreground">{storageLabel}</p>
					</div>
					<div class="flex items-center gap-2">
						<HardDriveIcon class="size-4 text-muted-foreground" />
						<span class="text-sm">
							{persistentStorage
								? m.video_editor_storage_persistent()
								: m.video_editor_storage_not_persistent()}
						</span>
						{#if persistentStorage === false || persistentStorage === undefined}
							<Button
								variant="outline"
								size="sm"
								disabled={storageRequesting}
								onclick={protectStorage}
							>
								{#if storageRequesting}<LoaderIcon class="size-4 animate-spin" />{/if}
								{storageRequesting
									? m.video_editor_storage_requesting()
									: m.video_editor_storage_request()}
							</Button>
						{/if}
					</div>
				</div>
				{#if storageMessage}
					<InlineNotice class="mt-4" tone={storageMessageTone} message={storageMessage} />
				{/if}
			</section>

			<section class="mt-10" aria-labelledby="recent-heading">
				<div>
					<h2 id="recent-heading" class="text-lg font-semibold">{m.video_editor_recent()}</h2>
					<p class="mt-1 text-sm text-muted-foreground">{m.video_editor_recent_description()}</p>
				</div>
				{#if recentProjects.length === 0}
					<div
						class="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
					>
						{m.video_editor_no_recent()}
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
												? m.video_editor_saved_cloud()
												: m.video_editor_local_only()}
										</span>
										{#if project.state === 'cloud'}<CloudIcon class="size-3.5" />{/if}
									</div>
								</div>
								<div class="flex shrink-0 items-center gap-1">
									<Button
										href={`/video-editor/${project.id}`}
										variant="outline"
										size="sm"
										disabled={!enabled || !capabilities?.supported}
									>
										{m.video_editor_open_project()}
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										onclick={() => requestDelete(project)}
										aria-label={m.video_editor_delete_project()}
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
							{m.video_editor_cloud_projects()}
						</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{m.video_editor_cloud_projects_description()}
						</p>
					</div>
					{#if cloudProjects.length === 0}
						<div
							class="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
						>
							{m.video_editor_cloud_empty()}
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
											{m.video_editor_sources_count({ count: project.source_count })}
										</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										disabled={!enabled || !capabilities?.supported || Boolean(openingCloudID)}
										onclick={() => void openCloudProject(project.id)}
									>
										{#if openingCloudID === project.id}
											<LoaderIcon class="size-4 animate-spin" />
											{m.video_editor_opening_cloud()}
										{:else}
											{m.video_editor_open_project()}
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
	title={m.video_editor_delete_title()}
	description={m.video_editor_delete_body()}
	onConfirm={confirmDelete}
/>
