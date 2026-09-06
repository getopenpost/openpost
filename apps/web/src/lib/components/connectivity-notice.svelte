<script lang="ts">
	import { onMount } from 'svelte';
	import { observeBrowserConnection } from '$lib/browser-connection';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { cn } from '$lib/utils';

	interface Props {
		/** Deterministic override for embedded and test consumers. */
		online?: boolean;
		class?: string;
	}

	let { online: onlineOverride, class: className }: Props = $props();
	let browserOnline = $state(true);
	let mounted = $state(false);
	let wasOnline = $state(true);
	let announcement = $state('');
	const online = $derived(onlineOverride ?? browserOnline);

	onMount(() => {
		const stop = observeBrowserConnection((online) => (browserOnline = online));
		wasOnline = onlineOverride ?? navigator.onLine;
		mounted = true;
		return stop;
	});

	$effect(() => {
		if (!mounted) return;
		if (online && !wasOnline) announcement = m.app_back_online();
		if (!online) announcement = '';
		wasOnline = online;
	});
</script>

{#if announcement}
	<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
{/if}
{#if !online}
	<InlineNotice tone="warning" class={cn('mx-4 mt-4 sm:mx-6 lg:mx-8', className)}>
		<p class="font-medium">{m.app_offline_banner_title()}</p>
		<p class="text-current/80">{m.app_offline_banner_description()}</p>
	</InlineNotice>
{/if}
