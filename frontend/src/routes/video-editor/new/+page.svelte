<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import WorkspaceGatePanel from '$lib/video-editor/components/workspace-gate-panel.svelte';
	import { createWorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
	import { createBlankProject } from '$lib/video-editor/project/defaults';
	import { createProject } from '$lib/video-editor/workspace-fs/projects';

	const gate = createWorkspaceGate();
	let attemptedRequest = $state('');
	let error = $state('');

	const request = $derived.by(() => {
		const name = page.url.searchParams.get('name')?.trim() || m.video_editor_project_untitled();
		const source = page.url.searchParams.get('source');
		const returnPublicationId = page.url.searchParams.get('return')?.trim() || null;
		return {
			key: `${name}\u0000${source ?? ''}\u0000${returnPublicationId ?? ''}`,
			name,
			source,
			returnPublicationId
		};
	});

	$effect(() => {
		if (gate.state !== 'ready' || attemptedRequest === request.key) return;
		attemptedRequest = request.key;
		error = '';
		void createAndOpen(request.name, request.source, request.returnPublicationId);
	});

	async function createAndOpen(
		name: string,
		source: string | null,
		returnPublicationId: string | null
	): Promise<void> {
		try {
			const project = createBlankProject(name);
			await createProject(project);
			const query = new URLSearchParams();
			if (source) query.set('source', source);
			if (returnPublicationId) query.set('return', returnPublicationId);
			const target = `/video-editor/${project.id}${query.size > 0 ? `?${query}` : ''}`;
			await goto(target, { replaceState: true });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		}
	}

	function retry(): void {
		attemptedRequest = '';
	}
</script>

<svelte:head><title>{m.video_editor_title()}</title></svelte:head>

<div
	class="video-editor-theme flex min-h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]"
>
	<header class="border-b border-[oklch(0.25_0.015_55)] px-4 py-2">
		<a
			href="/video-editor"
			class="flex w-fit items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.video_editor_title()}</span>
		</a>
	</header>

	<main class="flex flex-1 flex-col items-center justify-center px-4 py-10">
		{#if gate.state !== 'ready'}
			<WorkspaceGatePanel {gate} />
		{:else if error}
			<div class="w-full max-w-md">
				<InlineNotice tone="error">{error}</InlineNotice>
				<div class="mt-4 flex justify-center gap-2">
					<Button variant="outline" href="/video-editor">{m.video_editor_go_back()}</Button>
					<Button onclick={retry}>{m.common_retry()}</Button>
				</div>
			</div>
		{:else}
			<PageLoading label={m.editors_loading()} />
		{/if}
	</main>
</div>
