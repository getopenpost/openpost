<script lang="ts">
	import { resolve } from '$app/paths';
	import MessageCircleIcon from 'lucide-svelte/icons/message-circle';
	import InboxIcon from 'lucide-svelte/icons/inbox';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		active: 'engagement' | 'messages';
	}

	let { active }: Props = $props();
</script>

<nav class="flex gap-1 border-b" aria-label={m.communications_navigation()}>
	<a
		href={resolve('/engagement' as '/')}
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
		href={resolve('/messages' as '/')}
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
</nav>
