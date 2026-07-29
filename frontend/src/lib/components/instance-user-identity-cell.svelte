<script lang="ts">
	import type { components } from '$lib/api/types';
	import * as Avatar from '$lib/components/ui/avatar';

	type InstanceUser = components['schemas']['InstanceUserResponse'];

	let { user }: { user: InstanceUser } = $props();

	const displayName = $derived(user.display_name.trim() || user.email);
	const initials = $derived.by(() => {
		const name = user.display_name.trim();
		if (!name) return user.email.slice(0, 1).toUpperCase();
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part.slice(0, 1))
			.join('')
			.toUpperCase();
	});
</script>

<div class="flex min-w-52 items-center gap-3">
	<Avatar.Root class="size-9">
		{#if user.avatar_url}
			<Avatar.Image src={user.avatar_url} alt="" />
		{/if}
		<Avatar.Fallback>{initials}</Avatar.Fallback>
	</Avatar.Root>
	<div class="min-w-0">
		<p class="max-w-52 truncate text-sm font-medium" title={displayName}>{displayName}</p>
		<p class="max-w-52 truncate text-xs text-muted-foreground" title={user.email}>{user.email}</p>
	</div>
</div>
