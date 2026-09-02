<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { getSceneThumbnail } from '$lib/video-editor/workspace-fs/scene-analysis';

	let {
		relPath,
		revision = 0,
		alt = ''
	}: { relPath?: string; revision?: number; alt?: string } = $props();
	let element = $state<HTMLDivElement | null>(null);
	let url = $state('');
	let objectUrl = '';

	function replaceUrl(next: string): void {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		objectUrl = next;
		url = next;
	}

	$effect(() => {
		const path = relPath;
		void revision;
		if (!element || !path) {
			replaceUrl('');
			return;
		}
		replaceUrl('');
		let cancelled = false;
		let observer: IntersectionObserver | null = null;
		const load = async () => {
			const blob = await getSceneThumbnail(path);
			if (!cancelled && blob) replaceUrl(URL.createObjectURL(blob));
		};
		if ('IntersectionObserver' in globalThis) {
			observer = new IntersectionObserver(
				(entries) => {
					if (!entries.some((entry) => entry.isIntersecting)) return;
					observer?.disconnect();
					void load();
				},
				{ rootMargin: '160px' }
			);
			observer.observe(element);
		} else {
			void load();
		}
		return () => {
			cancelled = true;
			observer?.disconnect();
		};
	});

	onDestroy(() => replaceUrl(''));
</script>

<div bind:this={element} class="flex size-full items-center justify-center">
	{#if url}
		<img src={url} {alt} class="size-full object-cover" draggable="false" />
	{:else}
		<ProtectedIcon icon="editor-scenes" class="size-4 text-[oklch(0.5_0.015_55)]" />
	{/if}
</div>
