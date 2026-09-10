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
	class="inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-card p-1"
>
	<Button
		href={resolveAppPath(publicationView.listHref)}
		variant={view === 'list' ? 'secondary' : 'ghost'}
		size="sm"
		class="min-h-9 px-3"
		aria-current={view === 'list' ? 'page' : undefined}>{m.publication_view_list()}</Button
	>
	<Button
		href={resolveAppPath('/calendar')}
		variant={view === 'calendar' ? 'secondary' : 'ghost'}
		size="sm"
		class="min-h-9 px-3"
		aria-current={view === 'calendar' ? 'page' : undefined}>{m.sidebar_calendar()}</Button
	>
</nav>
