<script lang="ts">
	import type { components } from '$lib/api/types';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	type InstanceUser = components['schemas']['InstanceUserResponse'];

	interface Props {
		user: InstanceUser;
		busy: boolean;
		disabled?: boolean;
		onImpersonate: (user: InstanceUser) => void;
		onChangePlan: (user: InstanceUser) => void;
	}

	let { user, busy, disabled = false, onImpersonate, onChangePlan }: Props = $props();
</script>

<div class="flex items-center gap-1.5">
	<Button
		variant="outline"
		size="sm"
		onclick={() => onChangePlan(user)}
		disabled={busy || disabled}
		aria-label={m.settings_instance_change_plan_user({
			user: user.display_name.trim() || user.email
		})}
	>
		{#if busy}
			<ProtectedIcon icon="loading" class="size-3.5 animate-spin" />
		{:else}
			<ThemeIcon role="billing" class="size-3.5" />
		{/if}
		{m.settings_instance_change_plan()}
	</Button>
	{#if user.is_admin}
		<span class="text-xs text-muted-foreground"
			>{m.settings_instance_impersonation_unavailable()}</span
		>
	{:else}
		<Button
			variant="outline"
			size="sm"
			onclick={() => onImpersonate(user)}
			disabled={busy || disabled}
			aria-label={m.settings_instance_impersonate_user({
				user: user.display_name.trim() || user.email
			})}
		>
			{#if busy}
				<ProtectedIcon icon="loading" class="size-3.5 animate-spin" />
			{:else}
				<ThemeIcon role="user" class="size-3.5" />
			{/if}
			{m.settings_instance_impersonate()}
		</Button>
	{/if}
</div>
