import { onDestroy, untrack } from 'svelte';
import type { WorkspaceGate } from '../gate/workspace-gate.svelte';
import { getWorkspaceRoot } from '../workspace-fs/root';
import { getAllProjects, getProjectThumbnail } from '../workspace-fs/projects';
import type { Project } from './types';

import {
	loadLocalVideoProjectCatalog,
	releaseLocalVideoProjectThumbnails,
	type WorkspaceProjectLoaderDependencies
} from './workspace-project-catalog';

interface WorkspaceProjectCatalogDependencies extends WorkspaceProjectLoaderDependencies {
	getRoot(): FileSystemDirectoryHandle | null;
}

const defaultDependencies: WorkspaceProjectCatalogDependencies = {
	listProjects: getAllProjects,
	readThumbnail: getProjectThumbnail,
	createObjectURL: (blob) => URL.createObjectURL(blob),
	revokeObjectURL: (url) => URL.revokeObjectURL(url),
	getRoot: getWorkspaceRoot
};

export function createWorkspaceProjectCatalog(
	gate: Pick<WorkspaceGate, 'state' | 'workspaceRevision'>,
	overrides: Partial<WorkspaceProjectCatalogDependencies> = {}
) {
	const dependencies = { ...defaultDependencies, ...overrides };
	let projects = $state.raw<Project[]>([]);
	let thumbnailUrls = $state.raw<Record<string, string>>({});
	let loading = $state(false);
	let refreshing = $state(false);
	let error = $state('');
	let acceptedRoot: FileSystemDirectoryHandle | null = null;
	let acceptedRevision = -1;
	let generation = 0;
	let disposed = false;

	function replaceThumbnailUrls(next: Record<string, string>): void {
		releaseLocalVideoProjectThumbnails(thumbnailUrls, dependencies.revokeObjectURL);
		thumbnailUrls = next;
	}

	function clear(): void {
		generation += 1;
		projects = [];
		replaceThumbnailUrls({});
		loading = false;
		refreshing = false;
		error = '';
		acceptedRoot = null;
		acceptedRevision = -1;
	}

	async function refresh(): Promise<void> {
		if (disposed || gate.state !== 'ready') return;
		const root = dependencies.getRoot();
		if (!root) {
			clear();
			return;
		}
		const revision = gate.workspaceRevision;
		const preserveResults = acceptedRoot === root && acceptedRevision === revision;
		const requestGeneration = ++generation;
		if (!preserveResults) {
			projects = [];
			replaceThumbnailUrls({});
			acceptedRoot = null;
			acceptedRevision = -1;
		}
		loading = !preserveResults;
		refreshing = preserveResults;
		error = '';

		try {
			const snapshot = await loadLocalVideoProjectCatalog(dependencies);
			if (
				disposed ||
				requestGeneration !== generation ||
				gate.state !== 'ready' ||
				dependencies.getRoot() !== root
			) {
				releaseLocalVideoProjectThumbnails(snapshot.thumbnailUrls, dependencies.revokeObjectURL);
				return;
			}
			projects = snapshot.projects;
			replaceThumbnailUrls(snapshot.thumbnailUrls);
			acceptedRoot = root;
			acceptedRevision = revision;
		} catch (cause) {
			if (
				!disposed &&
				requestGeneration === generation &&
				gate.state === 'ready' &&
				dependencies.getRoot() === root
			) {
				error = cause instanceof Error ? cause.message : String(cause);
			}
		} finally {
			if (requestGeneration === generation) {
				loading = false;
				refreshing = false;
			}
		}
	}

	$effect(() => {
		const state = gate.state;
		const revision = gate.workspaceRevision;
		const root = dependencies.getRoot();
		if (state !== 'ready' || !root) {
			untrack(clear);
			return;
		}
		if (acceptedRoot !== root || acceptedRevision !== revision) {
			untrack(() => {
				clear();
				void refresh();
			});
		}
	});

	onDestroy(() => {
		disposed = true;
		clear();
	});

	return {
		get projects() {
			return projects;
		},
		get thumbnailUrls() {
			return thumbnailUrls;
		},
		get loading() {
			return loading;
		},
		get refreshing() {
			return refreshing;
		},
		get error() {
			return error;
		},
		refresh
	};
}

export type WorkspaceProjectCatalog = ReturnType<typeof createWorkspaceProjectCatalog>;
