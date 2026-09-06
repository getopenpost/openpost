<script lang="ts">
	import { onMount } from 'svelte';
	import { renderQueueRunner } from '../export/render-queue-runner';
	import { renderQueueStore } from '../export/render-queue-store';
	import {
		loadProjectRenderQueue,
		renderQueuePersistenceSignature,
		saveProjectRenderQueue
	} from '../export/render-queue-persistence';

	let {
		projectId,
		onerror = () => undefined,
		loadQueue = loadProjectRenderQueue,
		saveQueue = saveProjectRenderQueue
	}: {
		projectId: string;
		onerror?: (error: Error) => void;
		loadQueue?: typeof loadProjectRenderQueue;
		saveQueue?: typeof saveProjectRenderQueue;
	} = $props();

	let loadedProjectId: string | null = null;
	let loadVersion = 0;
	let lastSignature = '';
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saveChain = Promise.resolve();

	function signature(): string {
		return renderQueuePersistenceSignature($renderQueueStore.jobs, $renderQueueStore.isPaused);
	}

	function enqueueSave(projectId: string): void {
		const jobs = $renderQueueStore.jobs;
		const isPaused = $renderQueueStore.isPaused;
		saveChain = saveChain
			.catch(() => undefined)
			.then(() => saveQueue(projectId, jobs, isPaused))
			.catch((cause) => onerror(cause instanceof Error ? cause : new Error(String(cause))));
	}

	function persist(projectId: string, delay = 250): void {
		if (saveTimer) clearTimeout(saveTimer);
		if (delay === 0) {
			saveTimer = null;
			enqueueSave(projectId);
			return;
		}
		saveTimer = setTimeout(() => {
			saveTimer = null;
			enqueueSave(projectId);
		}, delay);
	}

	function scheduleSave(): void {
		if (loadedProjectId) persist(loadedProjectId);
	}

	$effect(() => {
		const nextSignature = signature();
		if (!loadedProjectId || nextSignature === lastSignature) return;
		lastSignature = nextSignature;
		scheduleSave();
	});

	$effect(() => {
		const targetId = projectId;
		const version = ++loadVersion;
		if (loadedProjectId) persist(loadedProjectId, 0);
		loadedProjectId = null;
		renderQueueStore.hydrate([], true);
		void loadQueue(targetId)
			.then((restored) => {
				if (version !== loadVersion) return;
				const restoredIds = new Set(restored.jobs.map((job) => job.id));
				const addedWhileLoading = $renderQueueStore.jobs.filter((job) => !restoredIds.has(job.id));
				renderQueueStore.hydrate([...restored.jobs, ...addedWhileLoading], restored.isPaused);
				loadedProjectId = targetId;
				lastSignature = signature();
				if (addedWhileLoading.length > 0) scheduleSave();
			})
			.catch((cause) => {
				if (version !== loadVersion) return;
				renderQueueStore.setPaused(false);
				loadedProjectId = targetId;
				lastSignature = signature();
				onerror(cause instanceof Error ? cause : new Error(String(cause)));
			});
	});

	onMount(() => {
		renderQueueRunner.start();
		return () => {
			if (loadedProjectId) {
				persist(loadedProjectId, 0);
			}
			renderQueueRunner.stop();
		};
	});
</script>
