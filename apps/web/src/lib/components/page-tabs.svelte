<script lang="ts" generics="T extends string">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';

	interface PageTab {
		id: T;
		href: string;
		label: string;
	}

	interface Props {
		tabs: PageTab[];
		active: T;
		label: string;
		testId?: string;
	}

	let { tabs, active, label, testId }: Props = $props();

	function navigate(event: MouseEvent, href: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		void goto(resolveAppPath(href));
	}
</script>

<!-- Route-backed peers of the shared Tabs primitive. Both follow the same theme recipe. -->
<nav aria-label={label} data-testid={testId} data-slot="tabs-list" class="flex min-w-0 gap-1">
	{#each tabs as tab (tab.id)}
		<a
			href={resolveAppPath(tab.href)}
			data-slot="tabs-trigger"
			data-state={active === tab.id ? 'active' : 'inactive'}
			data-cuelume-toggle="toggle"
			onclick={(event) => navigate(event, tab.href)}
			class="relative inline-flex min-h-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
			aria-current={active === tab.id ? 'page' : undefined}
		>
			{tab.label}
		</a>
	{/each}
</nav>
