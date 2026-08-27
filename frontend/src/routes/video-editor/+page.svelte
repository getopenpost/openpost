<!--
Local-first OpenPost Video Editor entry.
OWN-WORLD: dark editing chrome over OpenPost warm neutrals; the workspace folder on disk is the source of truth.
STORY: pick (or reconnect) a workspace folder once, then work with projects that never leave the machine.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import Logo from '$lib/components/Logo.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import ProjectBrowser from '$lib/video-editor/components/project-browser.svelte';
	import WorkspaceIndicator from '$lib/video-editor/components/workspace-indicator.svelte';
	import { createWorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
	import { saveProjectBundle } from '$lib/video-editor/project-bundle/bundle-export';
	import { importProjectBundle } from '$lib/video-editor/project-bundle/bundle-import';
	import type { BundleProgress } from '$lib/video-editor/project-bundle/bundle-types';
	import {
		downloadProjectSnapshot,
		importProjectSnapshotFile
	} from '$lib/video-editor/project-bundle/snapshot-service';
	import { duplicateProjectWithMedia } from '$lib/video-editor/project/project-operations';
	import { permanentlyDeleteProject } from '$lib/video-editor/project/project-trash';
	import type { Project } from '$lib/video-editor/project/types';
	import { onPermissionLost } from '$lib/video-editor/workspace-fs/root';
	import {
		createProject,
		getAllProjects,
		getProjectThumbnail,
		updateProject
	} from '$lib/video-editor/workspace-fs/projects';
	import {
		DEFAULT_TRASH_TTL_MS,
		listTrashedProjects,
		restoreProject,
		softDeleteProject,
		sweepTrashOlderThan,
		type TrashedProjectEntry
	} from '$lib/video-editor/workspace-fs/trash';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { onMount } from 'svelte';

	const PROJECT_THUMBNAIL_READ_CONCURRENCY = 8;

	const gate = createWorkspaceGate();
	let projects = $state.raw<Project[]>([]);
	let thumbnailUrls = $state.raw<Record<string, string>>({});
	let trashedProjects = $state.raw<TrashedProjectEntry[]>([]);
	let loadingProjects = $state(false);
	let projectsError = $state('');
	let trashError = $state('');
	let trashBusyId = $state<string | null>(null);
	let emptyingTrash = $state(false);
	let creating = $state(false);
	let importing = $state(false);
	let duplicatingId = $state<string | null>(null);
	let exportingId = $state<string | null>(null);
	let exportingKind = $state<'json' | 'bundle' | null>(null);
	let bundleProgress = $state<BundleProgress | null>(null);
	let bundleOperation = $state<'import' | 'export' | null>(null);
	let bundleController = $state<AbortController | null>(null);
	let bundleCanceling = $state(false);
	let projectLoadGeneration = 0;

	function replaceThumbnailUrls(next: Record<string, string>): void {
		for (const url of Object.values(thumbnailUrls)) URL.revokeObjectURL(url);
		thumbnailUrls = next;
	}

	async function loadProjectThumbnailUrls(
		projectsToLoad: Project[]
	): Promise<Record<string, string>> {
		const next: Record<string, string> = {};
		let nextIndex = 0;
		async function worker(): Promise<void> {
			while (nextIndex < projectsToLoad.length) {
				const project = projectsToLoad[nextIndex++];
				if (!project) continue;
				const thumbnail = await getProjectThumbnail(project.id);
				if (thumbnail) next[project.id] = URL.createObjectURL(thumbnail);
			}
		}
		await Promise.all(
			Array.from(
				{ length: Math.min(PROJECT_THUMBNAIL_READ_CONCURRENCY, projectsToLoad.length) },
				() => worker()
			)
		);
		return next;
	}

	async function loadProjects(sweepExpired = false): Promise<void> {
		if (gate.state !== 'ready') return;
		const generation = ++projectLoadGeneration;
		loadingProjects = true;
		projectsError = '';
		trashError = '';
		try {
			if (sweepExpired) {
				await sweepTrashOlderThan(DEFAULT_TRASH_TTL_MS, async (id) => {
					await permanentlyDeleteProject(id);
				});
			}
			const nextProjects = await getAllProjects();
			const nextThumbnailUrls = await loadProjectThumbnailUrls(nextProjects);
			let nextTrashedProjects = trashedProjects;
			let nextTrashError = '';
			try {
				nextTrashedProjects = await listTrashedProjects();
			} catch (error) {
				nextTrashError = error instanceof Error ? error.message : String(error);
			}
			if (generation !== projectLoadGeneration) {
				for (const url of Object.values(nextThumbnailUrls)) URL.revokeObjectURL(url);
				return;
			}
			projects = nextProjects;
			trashedProjects = nextTrashedProjects;
			trashError = nextTrashError;
			replaceThumbnailUrls(nextThumbnailUrls);
		} catch (error) {
			if (generation === projectLoadGeneration) {
				projectsError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (generation === projectLoadGeneration) loadingProjects = false;
		}
	}

	$effect(() => {
		void gate.workspaceRevision;
		if (gate.state === 'ready') void loadProjects(true);
	});

	onMount(() =>
		onPermissionLost(() => {
			showToast(m.video_editor_gate_permission_lost());
		})
	);

	onMount(() => () => {
		projectLoadGeneration += 1;
		replaceThumbnailUrls({});
	});

	async function openProject(project: Project): Promise<void> {
		await goto(`/video-editor/${project.id}`);
	}

	async function handleCreateProject(name: string): Promise<boolean> {
		if (creating || importing || exportingId || bundleOperation) return false;
		creating = true;
		try {
			const { createBlankProject } = await import('$lib/video-editor/project/defaults');
			const project = createBlankProject(name || m.video_editor_project_untitled());
			await createProject(project);
			await loadProjects();
			await openProject(project);
			return true;
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
			return false;
		} finally {
			creating = false;
		}
	}

	async function handleRename(project: Project): Promise<void> {
		if (importing || duplicatingId || exportingId || bundleOperation) return;
		const name = window.prompt(m.video_editor_project_rename_prompt(), project.name);
		if (name === null) return;
		const trimmed = name.trim();
		if (!trimmed || trimmed === project.name) return;
		try {
			await updateProject(project.id, { name: trimmed });
			await loadProjects();
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}

	async function handleDuplicate(project: Project): Promise<void> {
		if (duplicatingId || importing || exportingId || bundleOperation) return;
		duplicatingId = project.id;
		try {
			const duplicate = await duplicateProjectWithMedia(
				project.id,
				m.video_editor_project_copy_name({ name: project.name })
			);
			await loadProjects();
			showToast(m.video_editor_project_duplicated({ name: duplicate.name }), 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			duplicatingId = null;
		}
	}

	async function handleDelete(project: Project): Promise<void> {
		if (importing || duplicatingId || exportingId || bundleOperation) return;
		try {
			await softDeleteProject(project.id);
			await loadProjects();
			showToast(m.video_editor_project_moved_to_trash(), 'success', {
				actionLabel: m.video_editor_project_restore(),
				onAction: () => void handleRestore(project.id, project.name)
			});
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}

	async function handleDeleteBatch(targets: Project[]): Promise<string[]> {
		if (
			targets.length === 0 ||
			creating ||
			importing ||
			duplicatingId ||
			exportingId ||
			bundleOperation
		) {
			return targets.map((project) => project.id);
		}
		const moved: Project[] = [];
		const failed: Project[] = [];
		for (const project of targets) {
			try {
				await softDeleteProject(project.id);
				moved.push(project);
			} catch {
				failed.push(project);
			}
		}
		await loadProjects();
		const undoMoved = (): void => {
			void (async () => {
				const restoreFailures: Project[] = [];
				let restored = 0;
				for (const project of moved) {
					try {
						await restoreProject(project.id);
						restored += 1;
					} catch {
						restoreFailures.push(project);
					}
				}
				await loadProjects();
				if (restoreFailures.length > 0) {
					showToast(
						m.video_editor_project_bulk_restore_partial({
							restored,
							names: restoreFailures.map((project) => project.name).join(', ')
						}),
						'warning'
					);
				} else {
					showToast(m.video_editor_project_bulk_restored({ count: restored }), 'success');
				}
			})().catch((error) =>
				showToast(error instanceof Error ? error.message : String(error), 'error')
			);
		};
		if (failed.length > 0) {
			showToast(
				m.video_editor_project_bulk_trash_partial({
					moved: moved.length,
					names: failed.map((project) => project.name).join(', ')
				}),
				'warning',
				moved.length > 0
					? { actionLabel: m.video_editor_project_restore(), onAction: undoMoved }
					: undefined
			);
			return failed.map((project) => project.id);
		}
		showToast(m.video_editor_project_bulk_moved_to_trash({ count: moved.length }), 'success', {
			actionLabel: m.video_editor_project_restore(),
			onAction: undoMoved
		});
		return [];
	}

	async function handleRestore(projectId: string, projectName: string): Promise<void> {
		if (trashBusyId || emptyingTrash) return;
		trashBusyId = projectId;
		try {
			await restoreProject(projectId);
			await loadProjects();
			showToast(m.video_editor_project_restored({ name: projectName }), 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			trashBusyId = null;
		}
	}

	async function handlePurge(entry: TrashedProjectEntry): Promise<void> {
		if (trashBusyId || emptyingTrash) return;
		trashBusyId = entry.id;
		try {
			const result = await permanentlyDeleteProject(entry.id);
			await loadProjects();
			if (result.failedMediaIds.length > 0) {
				showToast(
					m.video_editor_project_media_cleanup_partial({
						count: result.failedMediaIds.length
					}),
					'warning'
				);
			} else {
				showToast(
					m.video_editor_project_deleted_forever({ name: entry.marker.originalName }),
					'success'
				);
			}
		} finally {
			trashBusyId = null;
		}
	}

	async function handleEmptyTrash(): Promise<void> {
		if (trashBusyId || emptyingTrash) return;
		emptyingTrash = true;
		const snapshot = [...trashedProjects];
		let deleted = 0;
		const failed: TrashedProjectEntry[] = [];
		let mediaCleanupFailures = 0;
		try {
			for (const entry of snapshot) {
				try {
					const result = await permanentlyDeleteProject(entry.id);
					deleted += 1;
					mediaCleanupFailures += result.failedMediaIds.length;
				} catch {
					failed.push(entry);
				}
			}
			await loadProjects();
			if (failed.length > 0) {
				showToast(
					m.video_editor_project_trash_partial({
						deleted,
						names: failed.map((entry) => entry.marker.originalName).join(', ')
					}),
					'warning'
				);
			} else if (mediaCleanupFailures > 0) {
				showToast(
					m.video_editor_project_media_cleanup_partial({ count: mediaCleanupFailures }),
					'warning'
				);
			} else {
				showToast(m.video_editor_project_trash_emptied({ count: deleted }), 'success');
			}
		} finally {
			emptyingTrash = false;
		}
	}

	async function handleImportJson(file: File): Promise<void> {
		if (importing || exportingId || bundleOperation) return;
		importing = true;
		try {
			const result = await importProjectSnapshotFile(file);
			await loadProjects();
			if (result.unmatchedMedia.length > 0) {
				showToast(
					m.video_editor_project_imported_missing_media({
						name: result.project.name,
						count: result.unmatchedMedia.length
					}),
					'warning'
				);
			} else {
				showToast(m.video_editor_project_imported({ name: result.project.name }), 'success');
			}
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			importing = false;
		}
	}

	async function handleImportBundle(file: File): Promise<void> {
		if (importing || exportingId || bundleOperation) return;
		const controller = new AbortController();
		importing = true;
		bundleOperation = 'import';
		bundleController = controller;
		bundleCanceling = false;
		bundleProgress = { stage: 'validating', percent: 0 };
		try {
			const result = await importProjectBundle(
				file,
				{ signal: controller.signal },
				(progress) => (bundleProgress = progress)
			);
			await loadProjects();
			showToast(
				m.video_editor_project_bundle_imported({
					name: result.projectName,
					imported: result.mediaImported,
					reused: result.mediaReused
				}),
				'success'
			);
		} catch (error) {
			if (
				error instanceof DOMException &&
				error.name === 'AbortError' &&
				controller.signal.aborted
			) {
				showToast(m.video_editor_project_bundle_canceled());
			} else if (!(error instanceof DOMException && error.name === 'AbortError')) {
				showToast(error instanceof Error ? error.message : String(error), 'error');
			}
		} finally {
			importing = false;
			if (bundleController === controller) {
				bundleController = null;
				bundleCanceling = false;
				bundleOperation = null;
				bundleProgress = null;
			}
		}
	}

	async function handleExportJson(project: Project): Promise<void> {
		if (exportingId || importing || bundleOperation) return;
		exportingId = project.id;
		exportingKind = 'json';
		try {
			await downloadProjectSnapshot(project.id);
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			exportingId = null;
			exportingKind = null;
		}
	}

	async function handleExportBundle(project: Project): Promise<void> {
		if (exportingId || importing || bundleOperation) return;
		const controller = new AbortController();
		exportingId = project.id;
		exportingKind = 'bundle';
		bundleOperation = 'export';
		bundleController = controller;
		bundleCanceling = false;
		bundleProgress = { stage: 'collecting', percent: 0 };
		try {
			await saveProjectBundle(
				project.id,
				project.name,
				(progress) => (bundleProgress = progress),
				controller.signal
			);
			showToast(m.video_editor_project_bundle_exported({ name: project.name }), 'success');
		} catch (error) {
			if (
				error instanceof DOMException &&
				error.name === 'AbortError' &&
				controller.signal.aborted
			) {
				showToast(m.video_editor_project_bundle_canceled());
			} else if (!(error instanceof DOMException && error.name === 'AbortError')) {
				showToast(error instanceof Error ? error.message : String(error), 'error');
			}
		} finally {
			exportingId = null;
			exportingKind = null;
			if (bundleController === controller) {
				bundleController = null;
				bundleCanceling = false;
				bundleOperation = null;
				bundleProgress = null;
			}
		}
	}

	function handleCancelBundle(): void {
		if (!bundleController || bundleController.signal.aborted) return;
		bundleCanceling = true;
		bundleController.abort();
	}
</script>

<svelte:head><title>{m.video_editor_title()}</title></svelte:head>

<div
	class="video-editor-theme flex min-h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]"
>
	<header
		class="flex items-center justify-between border-b border-[oklch(0.25_0.015_55)] px-4 py-2"
	>
		<a
			href="/editors"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.video_editor_title()}</span>
		</a>
		{#if gate.state === 'ready'}
			<WorkspaceIndicator {gate} />
		{/if}
	</header>

	<main class="flex flex-1 flex-col items-center justify-center px-4 py-10">
		{#if gate.state === 'initializing'}
			<PageLoading label={m.editors_loading()} />
		{:else if gate.state === 'unavailable'}
			<div class="max-w-md text-center">
				<h1 class="text-lg font-semibold">{m.video_editor_gate_unavailable_title()}</h1>
				<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
					{m.video_editor_gate_unavailable_body()}
				</p>
				<Button class="mt-6" onclick={() => history.back()}>{m.video_editor_go_back()}</Button>
			</div>
		{:else if gate.state === 'pick' || gate.state === 'reconnect'}
			<div
				class="w-full max-w-md rounded-xl border border-[oklch(0.25_0.015_55)] bg-[oklch(0.2_0.01_50)] p-8 text-center"
			>
				<FolderPlusIcon class="mx-auto size-10 text-[oklch(0.66_0.14_45)]" aria-hidden="true" />
				<h1 class="mt-4 text-lg font-semibold">
					{gate.state === 'pick'
						? m.video_editor_gate_pick_title()
						: m.video_editor_gate_reconnect_title()}
				</h1>
				<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
					{gate.state === 'pick'
						? m.video_editor_gate_pick_body()
						: m.video_editor_gate_reconnect_body({ folder: gate.workspaceName })}
				</p>
				{#if gate.error}
					<InlineNotice tone="error" class="mt-4 text-left">{gate.error}</InlineNotice>
				{/if}
				<div class="mt-6 flex flex-col items-center gap-2">
					{#if gate.state === 'pick'}
						<Button onclick={() => gate.pickFolder()} disabled={gate.busy}>
							{#if gate.busy}
								<LoaderIcon
									class="size-4 animate-spin motion-reduce:animate-none"
									aria-hidden="true"
								/>
							{:else}
								<FolderPlusIcon class="size-4" aria-hidden="true" />
							{/if}
							{m.video_editor_gate_pick_cta()}
						</Button>
					{:else}
						<Button onclick={() => gate.reconnect()} disabled={gate.busy}>
							{#if gate.busy}
								<LoaderIcon
									class="size-4 animate-spin motion-reduce:animate-none"
									aria-hidden="true"
								/>
							{:else}
								<RefreshCwIcon class="size-4" aria-hidden="true" />
							{/if}
							{m.video_editor_gate_reconnect_cta()}
						</Button>
						<Button variant="ghost" size="sm" onclick={() => gate.chooseDifferentFolder()}>
							{m.video_editor_gate_different_folder()}
						</Button>
					{/if}
				</div>
			</div>
		{:else if gate.state === 'ready'}
			<ProjectBrowser
				{projects}
				{thumbnailUrls}
				{trashedProjects}
				loading={loadingProjects}
				error={projectsError}
				{trashError}
				{trashBusyId}
				{emptyingTrash}
				{creating}
				{importing}
				{duplicatingId}
				{exportingId}
				{exportingKind}
				{bundleProgress}
				{bundleOperation}
				{bundleCanceling}
				oncreate={handleCreateProject}
				onimportjson={handleImportJson}
				onimportbundle={handleImportBundle}
				onopen={openProject}
				onrename={handleRename}
				onduplicate={handleDuplicate}
				onexportjson={handleExportJson}
				onexportbundle={handleExportBundle}
				oncancelbundle={handleCancelBundle}
				ondelete={handleDelete}
				ondeletebatch={handleDeleteBatch}
				onrestore={handleRestore}
				onpurge={handlePurge}
				onemptytrash={handleEmptyTrash}
			/>
		{/if}
	</main>
</div>
