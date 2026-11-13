<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { appBranding } from '$lib/app-branding.svelte';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { resolveAppPath } from '$lib/app-path';
	import PageContainer from '$lib/components/page-container.svelte';
	import { m } from '$lib/paraglide/messages';

	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');

	// The shell owns the single builder (see ideate-host.svelte) so generation
	// survives navigation; this page selects its context and gives it a place.
	$effect(() => {
		const workspace = workspaceId;
		if (!workspace) return;
		untrack(() => {
			if (!workspaceCtx.currentWorkspace?.can_edit) {
				void goto(resolveAppPath('/publications'), { replaceState: true });
				return;
			}
			ideate.open = false;
			const buildId = page.url.searchParams.get('build') ?? undefined;
			// Keep this page's running build when no specific build is requested. A
			// composer context applies into that composer, so never adopt it here.
			const entry = ideate.entry;
			if (buildId || !entry || entry.workspaceId !== workspace || entry.apply) {
				ideate.select({ workspaceId: workspace, contextKey: buildId ?? 'navigation', buildId });
			}
		});
	});

	function mountBuilder(node: HTMLElement) {
		ideate.pageTarget = node;
		return {
			destroy() {
				if (ideate.pageTarget === node) ideate.pageTarget = undefined;
			}
		};
	}
</script>

<svelte:head>
	<title>{m.nav_ideas()} — {appBranding.profile.display_name}</title>
</svelte:head>

<PageContainer title={m.nav_ideas()} themeIconRole="sparkles">
	<div use:mountBuilder class="min-w-0"></div>
</PageContainer>
