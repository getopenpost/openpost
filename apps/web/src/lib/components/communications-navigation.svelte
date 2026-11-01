<script lang="ts">
	import { resolveAppPath } from '$lib/app-path';
	import { goto } from '$app/navigation';
	import { m } from '$lib/paraglide/messages';

	type InboxTab = 'all' | 'comments' | 'messages' | 'reviews';

	interface Props {
		active: InboxTab;
	}

	let { active }: Props = $props();

	const tabs: { id: InboxTab; href: string; label: () => string }[] = [
		{ id: 'all', href: '/inbox/engagement', label: m.common_all },
		{
			id: 'comments',
			href: '/inbox/engagement?kind=comment',
			label: m.engagement_activity_comments
		},
		{ id: 'messages', href: '/inbox/messages', label: m.messages_heading },
		{
			id: 'reviews',
			href: '/inbox/engagement?kind=review',
			label: m.engagement_activity_reviews
		}
	];

	function navigate(event: MouseEvent, href: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		void goto(resolveAppPath(href));
	}
</script>

<nav
	class="flex min-w-0 gap-1 overflow-x-auto border-b"
	aria-label={m.communications_navigation()}
	data-testid="communications-navigation"
>
	{#each tabs as tab (tab.id)}
		<a
			href={resolveAppPath(tab.href)}
			data-cuelume-toggle="toggle"
			onclick={(event) => navigate(event, tab.href)}
			class={[
				'flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors',
				active === tab.id
					? 'border-primary text-foreground'
					: 'border-transparent text-muted-foreground hover:text-foreground'
			]}
			aria-current={active === tab.id ? 'page' : undefined}
		>
			{tab.label()}
		</a>
	{/each}
</nav>
