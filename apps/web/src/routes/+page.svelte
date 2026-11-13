<script lang="ts">
	import { appBranding } from '$lib/app-branding.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { goto, onNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveAppPath } from '$lib/app-path';
	import ComposeShell from '$lib/components/compose-shell.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { sidebarPreferences } from '$lib/stores/sidebar-preferences.svelte';

	const openComposer = sidebarPreferences.shouldOpenComposer(page.url.search !== '');
	if (openComposer) sidebarPreferences.requestComposer();
	$effect(() => {
		if (!openComposer) void goto(resolveAppPath('/publications'), { replaceState: true });
	});
	onNavigate(({ to }) => {
		if (to?.url.pathname !== '/') sidebarPreferences.leaveComposer();
	});

	let handoffSelected = $state(false);
	$effect(() => {
		if (workspaceCtx.currentWorkspace && !workspaceCtx.currentWorkspace.can_edit)
			void goto(resolveAppPath('/publications'), { replaceState: true });
	});
</script>

<svelte:head>
	<title>{appBranding.profile.display_name}</title>
</svelte:head>

<div class="flex flex-1 flex-col overflow-hidden">
	{#if handoffSelected}
		<div class="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
			<InlineNotice
				tone="success"
				message={m.accounts_callback_composer_selection_success()}
				class="mb-4"
			/>
		</div>
	{/if}
	{#if openComposer && workspaceCtx.currentWorkspace?.can_edit}<ComposeShell
			onHandoffSelected={() => (handoffSelected = true)}
		/>{/if}
</div>
