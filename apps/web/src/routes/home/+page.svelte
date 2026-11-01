<script lang="ts">
	import { appBranding } from '$lib/app-branding.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import WorkspaceSetupGuide from '$lib/components/workspace-setup-guide.svelte';
	import { m } from '$lib/paraglide/messages';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
</script>

<svelte:head>
	<title>{m.nav_home()} · {appBranding.profile.display_name}</title>
</svelte:head>

<PageContainer title={m.nav_home()} themeIconRole="home">
	<WorkspaceSetupGuide workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} />
</PageContainer>
