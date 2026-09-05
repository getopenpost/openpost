<!--
Local-first OpenPost Video Editor entry.
OWN-WORLD: dark editing chrome over OpenPost warm neutrals; the workspace folder on disk is the source of truth.
STORY: pick (or reconnect) a workspace folder once, then work with projects that never leave the machine.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import Logo from '$lib/components/Logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import ProjectBrowser from '$lib/video-editor/components/project-browser.svelte';
	import CloudProjectBrowser from '$lib/video-editor/components/cloud-project-browser.svelte';
	import WorkspaceIndicator from '$lib/video-editor/components/workspace-indicator.svelte';
	import WorkspaceGatePanel from '$lib/video-editor/components/workspace-gate-panel.svelte';
	import { createWorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
	import { saveProjectBundle } from '$lib/video-editor/project-bundle/bundle-export';
	import { importProjectBundle } from '$lib/video-editor/project-bundle/bundle-import';
	import type { BundleProgress } from '$lib/video-editor/project-bundle/bundle-types';
	import {
		downloadProjectSnapshot,
		importProjectSnapshotFile
	} from '$lib/video-editor/project-bundle/snapshot-service';
	import { duplicateProjectWithMedia } from '$lib/video-editor/project/project-operations';
	import type { ProjectDetailsUpdate } from '$lib/video-editor/project/project-details';
	import type { ProjectCreationSettings } from '$lib/video-editor/project/project-presets';
	import { permanentlyDeleteProject } from '$lib/video-editor/project/project-trash';
	import type { Project } from '$lib/video-editor/project/types';
	import {
		CloudVideoProjectRepository,
		type CloudVideoProject
	} from '$lib/video-editor/cloud/project-repository';
	import { importLocalProjectToCloud } from '$lib/video-editor/cloud/import-local-project';
	import { saveCloudProjectBundle } from '$lib/video-editor/cloud/export-project-bundle';
	import {
		isCloudProjectAvailableOffline,
		keepCloudProjectAvailableOffline,
		removeCloudProjectOfflineCopy
	} from '$lib/video-editor/cloud/offline-project-cache';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { createWorkspaceProjectCatalog } from '$lib/video-editor/project/workspace-project-catalog.svelte';
	import { onPermissionLost } from '$lib/video-editor/workspace-fs/root';
	import { createProject, updateProject } from '$lib/video-editor/workspace-fs/projects';
	import {
		DEFAULT_TRASH_TTL_MS,
		listTrashedProjects,
		restoreProject,
		softDeleteProject,
		sweepTrashOlderThan,
		type TrashedProjectEntry
	} from '$lib/video-editor/workspace-fs/trash';
	import { onMount, untrack } from 'svelte';

	const gate = createWorkspaceGate();
	const projectCatalog = createWorkspaceProjectCatalog(gate);
	let trashedProjects = $state.raw<TrashedProjectEntry[]>([]);
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
	let trashLoadGeneration = 0;
	let storageMode = $state<'cloud' | 'local'>('cloud');
	let storageModeChosen = $state(false);
	let cloudProjects = $state<CloudVideoProject<Project>[]>([]);
	let cloudTrashedProjects = $state<CloudVideoProject<Project>[]>([]);
	let cloudLoading = $state(false);
	let cloudError = $state('');
	let cloudCreating = $state(false);
	let cloudImportingId = $state<string | null>(null);
	let cloudExportingId = $state<string | null>(null);
	let cloudOfflineProjectIds = $state<string[]>([]);
	let cloudOfflineBusyId = $state<string | null>(null);
	let cloudLoadGeneration = 0;
	let cloudWorkspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let cloudRepository = $derived(
		cloudWorkspaceId ? new CloudVideoProjectRepository<Project>(cloudWorkspaceId) : null
	);

	async function loadCloudProjects(): Promise<void> {
		const generation = ++cloudLoadGeneration;
		const repository = cloudRepository;
		if (!repository) {
			cloudProjects = [];
			cloudTrashedProjects = [];
			return;
		}
		cloudLoading = true;
		cloudError = '';
		try {
			const projects = await repository.list(true);
			if (generation !== cloudLoadGeneration) return;
			cloudProjects = projects.filter((project) => !project.trashedAt);
			cloudTrashedProjects = projects.filter((project) => project.trashedAt);
			cloudLoading = false;
			void loadCloudOfflineProjectIds(generation, cloudWorkspaceId, cloudProjects);
		} catch {
			if (generation !== cloudLoadGeneration) return;
			cloudError = m.video_editor_cloud_projects_load_failed();
		} finally {
			if (generation === cloudLoadGeneration) cloudLoading = false;
		}
	}

	async function loadCloudOfflineProjectIds(
		generation: number,
		workspaceId: string,
		projects: CloudVideoProject<Project>[]
	): Promise<void> {
		try {
			const ids = (
				await Promise.all(
					projects.map(async (project) =>
						(await isCloudProjectAvailableOffline(workspaceId, project.id)) ? project.id : null
					)
				)
			).filter((id): id is string => id !== null);
			if (generation === cloudLoadGeneration && workspaceId === cloudWorkspaceId) {
				cloudOfflineProjectIds = ids;
			}
		} catch {
			// Offline state is an enhancement. Cloud project loading remains usable if storage is blocked.
		}
	}

	$effect(() => {
		void cloudWorkspaceId;
		if (!cloudWorkspaceId) storageMode = 'local';
		else {
			if (!storageModeChosen) storageMode = 'cloud';
			untrack(() => void loadCloudProjects());
		}
	});

	async function createCloudProject(name: string): Promise<void> {
		const repository = cloudRepository;
		if (!repository || cloudCreating) return;
		cloudCreating = true;
		try {
			const { createBlankProject } = await import('$lib/video-editor/project/defaults');
			const project = createBlankProject(name, {
				width: 1920,
				height: 1080,
				fps: 30
			});
			const created = await repository.create(project.name, project);
			await goto(`/video-editor/${created.id}?storage=cloud`);
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			cloudCreating = false;
		}
	}

	async function openCloudProject(project: CloudVideoProject<Project>): Promise<void> {
		await goto(`/video-editor/${project.id}?storage=cloud`);
	}

	async function importLocalProject(project: Project): Promise<void> {
		const repository = cloudRepository;
		if (!repository || cloudImportingId) return;
		cloudImportingId = project.id;
		try {
			const imported = await importLocalProjectToCloud(project, repository);
			await loadCloudProjects();
			await openCloudProject(imported);
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			cloudImportingId = null;
		}
	}

	async function exportCloudProject(project: CloudVideoProject<Project>): Promise<void> {
		const repository = cloudRepository;
		if (!repository || cloudExportingId) return;
		cloudExportingId = project.id;
		try {
			await saveCloudProjectBundle(repository, project.id, project.name);
			showToast(m.video_editor_project_bundle_exported({ name: project.name }), 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			cloudExportingId = null;
		}
	}

	async function trashCloudProject(project: CloudVideoProject<Project>): Promise<void> {
		const repository = cloudRepository;
		if (!repository) return;
		try {
			await repository.trash(project.id);
			await removeCloudProjectOfflineCopy(repository.workspaceId, project.id);
			await loadCloudProjects();
			showToast(m.editors_delete_cloud_video_success(), 'success');
		} catch {
			showToast(m.editors_delete_cloud_video_failed(), 'error');
		}
	}

	async function toggleCloudProjectOffline(project: CloudVideoProject<Project>): Promise<void> {
		const repository = cloudRepository;
		if (!repository || cloudOfflineBusyId) return;
		cloudOfflineBusyId = project.id;
		try {
			if (cloudOfflineProjectIds.includes(project.id)) {
				await removeCloudProjectOfflineCopy(repository.workspaceId, project.id);
				cloudOfflineProjectIds = cloudOfflineProjectIds.filter((id) => id !== project.id);
			} else {
				await keepCloudProjectAvailableOffline(repository, project.id);
				cloudOfflineProjectIds = [...cloudOfflineProjectIds, project.id];
			}
		} catch (error) {
			showToast(error instanceof Error ? error.message : m.video_editor_offline_failed(), 'error');
		} finally {
			cloudOfflineBusyId = null;
		}
	}

	async function restoreCloudProject(project: CloudVideoProject<Project>): Promise<void> {
		const repository = cloudRepository;
		if (!repository) return;
		try {
			await repository.restore(project.id);
			await loadCloudProjects();
			showToast(m.video_editor_project_restored({ name: project.name }), 'success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}

	async function loadTrash(sweepExpired = false): Promise<void> {
		if (gate.state !== 'ready') return;
		const generation = ++trashLoadGeneration;
		trashError = '';
		try {
			if (sweepExpired) {
				await sweepTrashOlderThan(DEFAULT_TRASH_TTL_MS, async (id) => {
					await permanentlyDeleteProject(id);
				});
			}
			const nextTrashedProjects = await listTrashedProjects();
			if (generation === trashLoadGeneration) trashedProjects = nextTrashedProjects;
		} catch (error) {
			if (generation === trashLoadGeneration) {
				trashError = error instanceof Error ? error.message : String(error);
			}
		}
	}

	async function loadProjects(sweepExpired = false): Promise<void> {
		await Promise.all([projectCatalog.refresh(), loadTrash(sweepExpired)]);
	}

	$effect(() => {
		const state = gate.state;
		void gate.workspaceRevision;
		if (state === 'ready') {
			untrack(() => void loadTrash(true));
		} else {
			trashLoadGeneration += 1;
			trashedProjects = [];
			trashError = '';
		}
	});

	onMount(() => {
		const stopPermissionListener = onPermissionLost(() => {
			showToast(m.video_editor_gate_permission_lost());
		});
		return () => {
			trashLoadGeneration += 1;
			stopPermissionListener();
		};
	});

	async function openProject(project: Project): Promise<void> {
		await goto(`/video-editor/${project.id}`);
	}

	async function handleCreateProject(
		name: string,
		settings: ProjectCreationSettings
	): Promise<boolean> {
		if (creating || importing || exportingId || bundleOperation) return false;
		creating = true;
		try {
			const { createBlankProject } = await import('$lib/video-editor/project/defaults');
			const project = createBlankProject(name || m.video_editor_project_untitled(), settings);
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

	async function handleUpdateProject(
		project: Project,
		update: ProjectDetailsUpdate
	): Promise<string | null> {
		if (importing || duplicatingId || exportingId || bundleOperation) {
			return m.video_editor_project_edit_busy();
		}
		try {
			await updateProject(project.id, update);
			await loadProjects();
			showToast(m.video_editor_project_changes_saved(), 'success');
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
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
					? {
							actionLabel: m.video_editor_project_restore(),
							onAction: undoMoved
						}
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
					m.video_editor_project_deleted_forever({
						name: entry.marker.originalName
					}),
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
					m.video_editor_project_media_cleanup_partial({
						count: mediaCleanupFailures
					}),
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
	class="video-editor-theme flex min-h-dvh flex-col bg-[var(--video-editor-canvas)] text-[var(--video-editor-text)]"
>
	<header
		class="flex items-center justify-between border-b border-[var(--video-editor-border)] px-4 py-2"
	>
		<a
			href="/editors"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--video-editor-focus)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.video_editor_title()}</span>
		</a>
		<div class="flex items-center gap-2">
			{#if cloudWorkspaceId}
				<div
					class="flex rounded-lg border border-[var(--video-editor-border)] p-0.5"
					aria-label={m.video_editor_projects_title()}
				>
					<Button
						variant={storageMode === 'cloud' ? 'secondary' : 'ghost'}
						size="xs"
						aria-pressed={storageMode === 'cloud'}
						onclick={() => {
							storageModeChosen = true;
							storageMode = 'cloud';
						}}>{m.video_editor_cloud_projects()}</Button
					>
					<Button
						variant={storageMode === 'local' ? 'secondary' : 'ghost'}
						size="xs"
						aria-pressed={storageMode === 'local'}
						onclick={() => {
							storageModeChosen = true;
							storageMode = 'local';
						}}>{m.video_editor_local_only()}</Button
					>
				</div>
			{/if}
			{#if storageMode === 'local' && gate.state === 'ready'}
				<WorkspaceIndicator {gate} />
			{/if}
		</div>
	</header>

	<main class="flex flex-1 flex-col items-center justify-center px-4 py-10">
		{#if storageMode === 'cloud' && cloudRepository}
			<CloudProjectBrowser
				projects={cloudProjects}
				trashedProjects={cloudTrashedProjects}
				loading={cloudLoading}
				error={cloudError}
				creating={cloudCreating}
				localProjects={projectCatalog.projects}
				importingId={cloudImportingId}
				exportingId={cloudExportingId}
				offlineProjectIds={cloudOfflineProjectIds}
				offlineBusyId={cloudOfflineBusyId}
				oncreate={createCloudProject}
				onopen={openCloudProject}
				ontrash={trashCloudProject}
				onrestore={restoreCloudProject}
				onimportlocal={importLocalProject}
				onexport={exportCloudProject}
				ontoggleoffline={toggleCloudProjectOffline}
				onrefresh={loadCloudProjects}
			/>
		{:else if gate.state !== 'ready'}
			<WorkspaceGatePanel {gate} />
		{:else if gate.state === 'ready'}
			<ProjectBrowser
				projects={projectCatalog.projects}
				thumbnailUrls={projectCatalog.thumbnailUrls}
				{trashedProjects}
				loading={projectCatalog.loading}
				error={projectCatalog.error}
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
				onupdate={handleUpdateProject}
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
