<script lang="ts">
	import { onMount } from 'svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { page } from '$app/stores';
	import {
		SocialPreviewPage,
		platformNames,
		type PreviewModel,
		type PreviewScheme
	} from '@openpost/social-preview';
	import { Button } from '$lib/components/ui/button';
	import { channelName } from '$lib/preview-window';
	import { m } from '$lib/paraglide/messages';

	type PreviewChannelMessage =
		| { type: 'ready' }
		| { type: 'snapshot'; model: PreviewModel }
		| { type: 'disconnected' }
		| { type: 'closed' };

	let model = $state<PreviewModel | null>(null);
	let connected = $state(false);
	let invalid = $state(false);
	let previewWidth = $state<number | null>(null);
	let scheme = $state<PreviewScheme>('system');
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
	<title>{pageTitle}</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

{#if invalid}
	<main class="preview-connection-state">
		<section>
			<h1>{m.compose_preview()}</h1>
			<p>{m.preview_invalid_link()}</p>
		</section>
	</main>
{:else if model}
	<div
		class="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-3 py-2 text-foreground"
	>
		<strong class="text-sm">{pageTitle}</strong>
		<div class="flex flex-wrap items-center gap-3">
			<div class="flex flex-wrap gap-1" role="group" aria-label={m.preview_width()}>
				{#each [null, 320, 390, 768, 1200] as width (width)}
					<Button
						variant={previewWidth === width ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={previewWidth === width}
						onclick={() => (previewWidth = width)}
						>{width === null ? m.preview_fit() : `${width}px`}</Button
					>
				{/each}
			</div>
			<div class="flex gap-1" role="group" aria-label={m.settings_appearance()}>
				{#each [{ value: 'system', label: m.sidebar_appearance_system() }, { value: 'light', label: m.sidebar_appearance_light() }, { value: 'dark', label: m.sidebar_appearance_dark() }] as option (option.value)}
					<Button
						variant={scheme === option.value ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={scheme === option.value}
						onclick={() => (scheme = option.value as PreviewScheme)}>{option.label}</Button
					>
				{/each}
			</div>
		</div>
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users can focus this scroll region to pan a preview wider than the window.) -->
	<div class="preview-stage" tabindex="0" role="region" aria-label={m.compose_preview()}>
		<div class="preview-frame" style:width={previewWidth ? `${previewWidth}px` : '100%'}>
			<SocialPreviewPage {model} {scheme} />
		</div>
	</div>
	{#if !connected}
		<div class="preview-disconnected" role="status">
			<ThemeIcon role="plugin" />
			<span>
				<strong>{m.preview_sync_stopped()}</strong>
				<small>{m.preview_sync_stopped_body()}</small>
			</span>
		</div>
	{/if}
{:else}
	<main class="preview-connection-state" role="status" aria-live="polite">
		<section>
			<div class="waiting-mark" aria-hidden="true"><span></span></div>
			<h1>{m.preview_waiting()}</h1>
			<p>{m.preview_waiting_body()}</p>
		</section>
	</main>
{/if}

<style>
	.preview-stage {
		min-height: calc(100dvh - 3.5rem);
		overflow: auto;
		background: var(--muted);
	}
	.preview-stage:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.preview-frame {
		margin-inline: auto;
		min-height: calc(100dvh - 3.5rem);
	}
	.preview-connection-state {
		display: grid;
		min-height: 100dvh;
		place-items: center;
		background: #0f1012;
		color: #f6f7f9;
		padding: 1.5rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		text-align: center;
	}

	.preview-connection-state section {
		display: grid;
		justify-items: center;
		gap: 0.75rem;
		max-width: 30rem;
	}

	.preview-connection-state h1 {
		margin: 0;
		font-size: 1.1rem;
	}

	.preview-connection-state p {
		margin: 0;
		color: #aeb3bd;
		font-size: 0.85rem;
		line-height: 1.55;
	}

	.waiting-mark {
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 1px solid #34373f;
		border-radius: 50%;
	}

	.waiting-mark span {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: #f6f7f9;
		animation: breathe 1.4s ease-in-out infinite;
	}

	.preview-disconnected {
		position: fixed;
		z-index: 100;
		right: 1rem;
		bottom: 1rem;
		display: flex;
		max-width: min(24rem, calc(100vw - 2rem));
		align-items: center;
		gap: 0.65rem;
		border: 1px solid rgb(255 255 255 / 12%);
		border-radius: 0.6rem;
		background: rgb(25 26 30 / 94%);
		color: #fff;
		box-shadow: 0 8px 28px rgb(0 0 0 / 28%);
		padding: 0.75rem 0.85rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.preview-disconnected > :global(svg) {
		width: 1.1rem;
		height: 1.1rem;
		flex: 0 0 auto;
		color: #aeb3bd;
	}

	.preview-disconnected span {
		display: grid;
		gap: 0.1rem;
	}

	.preview-disconnected strong {
		font-size: 0.78rem;
	}

	.preview-disconnected small {
		color: #aeb3bd;
		font-size: 0.68rem;
		line-height: 1.35;
	}

	@keyframes breathe {
		0%,
		100% {
			opacity: 0.35;
			scale: 0.75;
		}
		50% {
			opacity: 1;
			scale: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.waiting-mark span {
			animation: none;
		}
	}
</style>
