<script lang="ts">
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { goto } from '$app/navigation';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import InboxIcon from '@lucide/svelte/icons/inbox';
	import BellIcon from '@lucide/svelte/icons/bell';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		active: 'engagement' | 'messages' | 'notifications';
	}

	let { active }: Props = $props();

	function navigate(event: MouseEvent, href: '/inbox/engagement' | '/inbox/messages' | '/inbox/notifications') {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		void goto(resolveAppPath(href));
	}
</script>

<nav
	class="flex gap-1 border-b"
	aria-label={m.communications_navigation()}
	data-testid="communications-navigation"
>
	<a
		href={resolve('/inbox/engagement' as '/')}
		data-cuelume-toggle="toggle"
		onclick={(event) => navigate(event, '/inbox/engagement')}
		class={[
			'flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
			active === 'engagement'
				? 'border-primary text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'
		]}
		aria-current={active === 'engagement' ? 'page' : undefined}
	>
		<MessageCircleIcon class="size-4" />
		{m.engagement_heading()}
	</a>
	<a
		href={resolve('/inbox/messages' as '/')}
		data-cuelume-toggle="toggle"
		onclick={(event) => navigate(event, '/inbox/messages')}
		class={[
			'flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
			active === 'messages'
				? 'border-primary text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'
		]}
		aria-current={active === 'messages' ? 'page' : undefined}
	>
		<InboxIcon class="size-4" />
		{m.messages_heading()}
	</a>
	<a
		href={resolve('/inbox/notifications' as '/')}
		data-cuelume-toggle="toggle"
		onclick={(event) => navigate(event, '/inbox/notifications')}
		class={[
			'flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors',
			active === 'notifications'
				? 'border-primary text-foreground'
				: 'border-transparent text-muted-foreground hover:text-foreground'
		]}
		aria-current={active === 'notifications' ? 'page' : undefined}
	>
		<BellIcon class="size-4" />
		{m.notifications_heading()}
	</a>
</nav>
