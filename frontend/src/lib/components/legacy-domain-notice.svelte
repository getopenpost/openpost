<script lang="ts">
	import { browser } from '$app/environment';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		/** Deterministic override for embedded and test consumers. */
		url?: URL;
	}

	let { url: urlOverride }: Props = $props();
	const currentURL = $derived(urlOverride ?? (browser ? new URL(window.location.href) : null));
	const targetURL = $derived.by(() => {
		if (currentURL?.hostname !== 'app.openpost.social') return null;
		return new URL(
			`${currentURL.pathname}${currentURL.search}${currentURL.hash}`,
			'https://app.openpo.st'
		);
	});
</script>

{#if targetURL}
	<InlineNotice tone="info" class="mx-4 mt-4 sm:mx-6 lg:mx-8">
		<p class="font-medium">{m.app_domain_migration_title()}</p>
		<p class="text-current/80">{m.app_domain_migration_description()}</p>
		{#snippet actions()}
			<Button href={targetURL.href} variant="outline" size="sm">
				{m.app_domain_migration_action()}
			</Button>
		{/snippet}
	</InlineNotice>
{/if}
