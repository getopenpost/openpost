<script lang="ts">
	import PageTabs from '$lib/components/page-tabs.svelte';
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
</script>

<PageTabs
	{active}
	label={m.communications_navigation()}
	testId="communications-navigation"
	tabs={tabs.map((tab) => ({ id: tab.id, href: tab.href, label: tab.label() }))}
/>
