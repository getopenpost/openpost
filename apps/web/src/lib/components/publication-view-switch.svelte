<script lang="ts">
	import { onMount } from 'svelte';
	import { resolveAppPath } from '$lib/app-path';
	import { publicationView } from '$lib/stores/publication-view.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import { Button } from '$lib/components/ui/button';
	let { view }: { view: 'list' | 'calendar' } = $props();
	onMount(() => publicationView.remember(view));
</script>

<nav
	aria-label={m.publication_view_label()}
	class="inline-flex w-full items-center gap-1 rounded-lg bg-muted p-1 sm:w-auto"
>
	<Button
		href={resolveAppPath(publicationView.listHref)}
		variant="ghost"
		size="sm"
		class={`min-h-11 flex-1 gap-2 px-4 sm:min-h-9 ${view === 'list' ? 'bg-background text-foreground' : ''}`}
		aria-current={view === 'list' ? 'page' : undefined}
		><ThemeIcon role="publications" class="size-4" />{m.publication_view_list()}</Button
	>
	<Button
		href={resolveAppPath('/calendar')}
		variant="ghost"
		size="sm"
		class={`min-h-11 flex-1 gap-2 px-4 sm:min-h-9 ${view === 'calendar' ? 'bg-background text-foreground' : ''}`}
		aria-current={view === 'calendar' ? 'page' : undefined}
		><ThemeIcon role="calendar" class="size-4" />{m.sidebar_calendar()}</Button
	>
</nav>
