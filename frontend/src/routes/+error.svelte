<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppErrorState from '$lib/components/app-error-state.svelte';
	import { resolveAppErrorProjection } from '$lib/app-error-presentation';
	import { observeBrowserConnection } from '$lib/browser-connection';

	let online = $state(true);
	const error = $derived(resolveAppErrorProjection(page.status, online));
	const title = $derived(error.presentation.title);

	onMount(() => {
		return observeBrowserConnection((connected) => (online = connected));
	});

	async function goBack() {
		if (window.history.length > 1) {
			window.history.back();
			return;
		}
		await goto(resolve('/'));
	}

	function retry() {
		window.location.reload();
	}

	const links = {
		home: resolve('/'),
		activity: resolve('/publications'),
		calendar: resolve('/calendar'),
		media: resolve('/media')
	};
</script>

<svelte:head>
	<title>{page.status} — {title} — OpenPost</title>
</svelte:head>

<AppErrorState status={page.status} {online} onBack={goBack} onRetry={retry} {links} />
