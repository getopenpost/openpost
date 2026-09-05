<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import {
		provideSettingsInitialLoadBoundary,
		type SettingsInitialLoadPlan
	} from './settings-initial-load.svelte';
	let { children, plan }: { children: Snippet; plan: SettingsInitialLoadPlan } = $props();
	const boundary = provideSettingsInitialLoadBoundary(() => plan);
	$effect.pre(() => boundary.activate(plan));
</script>

<PageContainer title="Settings" loading={boundary.loading} mountWhileLoading>
	{@render children()}
</PageContainer>
