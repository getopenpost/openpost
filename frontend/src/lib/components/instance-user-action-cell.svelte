<script lang="ts">
	import type { components } from '$lib/api/types';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import UserRoundCogIcon from '@lucide/svelte/icons/user-round-cog';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	type InstanceUser = components['schemas']['InstanceUserResponse'];

	interface Props {
		user: InstanceUser;
		busy: boolean;
		onImpersonate: (user: InstanceUser) => void;
	}

	let { user, busy, onImpersonate }: Props = $props();
</script>

{#if user.is_admin}
	<span class="text-xs text-muted-foreground"
		>{m.settings_instance_impersonation_unavailable()}</span
	>
{:else}
	<Button
		variant="outline"
		size="sm"
		onclick={() => onImpersonate(user)}
		disabled={busy}
		aria-label={m.settings_instance_impersonate_user({
			user: user.display_name.trim() || user.email
		})}
	>
		{#if busy}
			<LoaderIcon class="size-3.5 animate-spin" />
		{:else}
			<UserRoundCogIcon class="size-3.5" />
		{/if}
		{m.settings_instance_impersonate()}
	</Button>
{/if}
