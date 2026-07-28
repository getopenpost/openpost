<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { SocialPreview, platformNames, type PreviewModel } from '@openpost/social-preview';
	import Logo from '$lib/components/Logo.svelte';
	import { channelName } from '$lib/preview-window';
	import { m } from '$lib/paraglide/messages';
	import RadioIcon from 'lucide-svelte/icons/radio';
	import UnplugIcon from 'lucide-svelte/icons/unplug';

	type PreviewChannelMessage =
		| { type: 'ready' }
		| { type: 'snapshot'; model: PreviewModel }
		| { type: 'disconnected' }
		| { type: 'closed' };

	let model = $state<PreviewModel | null>(null);
	let connected = $state(false);
	let invalid = $state(false);
	let channel: BroadcastChannel | null = null;
	const pageTitle = $derived(
		model
			? m.preview_window_title({ platform: platformNames[model.platform] })
			: m.compose_preview()
	);

	onMount(() => {
		const token = $page.url.searchParams.get('token');
		if (!token || typeof BroadcastChannel === 'undefined') {
			invalid = true;
			return;
		}
		channel = new BroadcastChannel(channelName(token));
		channel.onmessage = (event: MessageEvent<PreviewChannelMessage>) => {
			if (event.data?.type === 'disconnected') {
				connected = false;
				return;
			}
			if (event.data?.type !== 'snapshot' || !event.data.model) return;
			model = event.data.model;
			connected = true;
		};
		channel.postMessage({ type: 'ready' } satisfies PreviewChannelMessage);
		const markDisconnected = () => {
			connected = false;
		};
		window.addEventListener('pagehide', markDisconnected);
		return () => {
			window.removeEventListener('pagehide', markDisconnected);
			channel?.postMessage({ type: 'closed' } satisfies PreviewChannelMessage);
			channel?.close();
		};
	});
</script>

<svelte:head>
	<title>{pageTitle} · OpenPost</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main class="min-h-dvh bg-muted/25 px-4 py-6 sm:px-6 sm:py-10">
	<div class="mx-auto grid w-full max-w-4xl gap-5">
		<header class="flex flex-wrap items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<Logo width={42} height={33} />
				<div>
					<h1 class="text-lg font-semibold tracking-tight">{pageTitle}</h1>
					<p class="text-sm text-muted-foreground">
						{model ? `${platformNames[model.platform]} · ${model.format}` : m.compose_preview()}
					</p>
				</div>
			</div>
			{#if connected}
				<div
					class="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary/10 px-3 text-sm font-medium text-primary"
				>
					<RadioIcon class="size-4" aria-hidden="true" />
					{m.preview_live()}
				</div>
			{:else if model}
				<div
					class="inline-flex min-h-11 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium text-muted-foreground"
				>
					<UnplugIcon class="size-4" aria-hidden="true" />
					{m.preview_sync_stopped()}
				</div>
			{/if}
		</header>

		{#if invalid}
			<section class="rounded-xl border bg-card p-6 text-center">
				<h2 class="font-semibold">{m.compose_preview()}</h2>
				<p class="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
					{m.preview_invalid_link()}
				</p>
			</section>
		{:else if model}
			<section class="grid place-items-center rounded-xl bg-background p-3 sm:p-8">
				<SocialPreview {model} />
			</section>
			<p class="text-center text-xs leading-5 text-muted-foreground">
				{connected ? m.preview_live_body() : m.preview_sync_stopped_body()}
			</p>
		{:else}
			<section
				class="grid min-h-[28rem] place-items-center rounded-xl border bg-card p-6 text-center"
				role="status"
				aria-live="polite"
			>
				<div>
					<RadioIcon class="mx-auto size-8 text-primary" aria-hidden="true" />
					<h2 class="mt-4 font-semibold">{m.preview_waiting()}</h2>
					<p class="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
						{m.preview_waiting_body()}
					</p>
				</div>
			</section>
		{/if}
	</div>
</main>
