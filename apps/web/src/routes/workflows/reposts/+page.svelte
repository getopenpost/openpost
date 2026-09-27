<script lang="ts">
	import { page } from '$app/state';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import RepostAutomationSettings from '$lib/components/repost-automation-settings.svelte';
	import RepostHistory from '$lib/workflows/repost-history.svelte';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	let tab = $state<'configure' | 'runs'>('configure');
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
</script>

<svelte:head><title>{m.repost_heading()} · {m.workflows_title()} · OpenPost</title></svelte:head>
<PageContainer title={m.workflows_title()} themeIconRole="repeat">
	{#snippet navigation()}
		<div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
			<Button href="/workflows" variant="ghost"
				><ThemeIcon role="arrow-left" class="size-4" />{m.workflows_back()}</Button
			>
			<div class="flex gap-2">
				<Button
					variant={tab === 'configure' ? 'secondary' : 'ghost'}
					onclick={() => (tab = 'configure')}>{m.workflows_configure()}</Button
				><Button variant={tab === 'runs' ? 'secondary' : 'ghost'} onclick={() => (tab = 'runs')}
					>{m.workflows_runs()}</Button
				>
			</div>
		</div>
	{/snippet}
	<div hidden={tab !== 'configure'}>
		<RepostAutomationSettings
			{workspaceID}
			selectedPolicyID={page.url.searchParams.get('policy') ?? ''}
			template={page.url.searchParams.get('template') ?? ''}
		/>
	</div>
	{#if tab === 'runs'}<RepostHistory {workspaceID} />{/if}
</PageContainer>
