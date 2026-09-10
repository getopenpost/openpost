<script lang="ts">
	import { onMount } from 'svelte';
	import { resolveAppPath } from '$lib/app-path';
	import { publicationView } from '$lib/stores/publication-view.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	let { view }: { view: 'list' | 'calendar' } = $props();
	onMount(() => publicationView.remember(view));
</script>

<nav
	aria-label={m.publication_view_label()}
	class="inline-flex shrink-0 gap-1 rounded-md bg-muted p-1"
>
	<Button
		href={resolveAppPath('/publications')}
		variant={view === 'list' ? 'secondary' : 'ghost'}
		size="sm"
		aria-current={view === 'list' ? 'page' : undefined}>{m.publication_view_list()}</Button
	>
	<Button
		href={resolveAppPath('/calendar')}
		variant={view === 'calendar' ? 'secondary' : 'ghost'}
		size="sm"
		aria-current={view === 'calendar' ? 'page' : undefined}>{m.sidebar_calendar()}</Button
	>
</nav>
