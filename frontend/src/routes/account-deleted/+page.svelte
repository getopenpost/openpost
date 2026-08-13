<script lang="ts">
	import { resolve } from '$app/paths';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.auth_account_deleted_title()}</title>
</svelte:head>

{#snippet successIcon()}
	<CheckCircleIcon class="size-6 text-emerald-600 dark:text-emerald-400" />
{/snippet}

<StandaloneShell
	title={m.auth_account_deleted_heading()}
	description={m.auth_account_deleted_description()}
	icon={successIcon}
>
	<a
		href={resolve('/')}
		class="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
	>
		{m.auth_account_deleted_home()}
	</a>
</StandaloneShell>
