<script lang="ts">
	import type { Snippet } from 'svelte';
	import Logo from '$lib/components/Logo.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import { m } from '$lib/paraglide/messages';

	let {
		kind,
		title,
		description,
		actions,
		utility,
		children,
		heading = $bindable()
	}: {
		kind: 'image' | 'video';
		title: string;
		description: string;
		actions: Snippet;
		utility?: Snippet;
		children: Snippet;
		heading?: HTMLHeadingElement | null;
	} = $props();
</script>

<header class="border-b bg-background">
	<div class="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
		<a
			href="/editors"
			class="flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-ring"
			aria-label={m.editors_title()}
		>
			<Logo width={112} height={33} />
		</a>
		<nav class="flex items-center gap-1" aria-label={m.editors_title()}>
			<a
				href="/image-editor"
				aria-current={kind === 'image' ? 'page' : undefined}
				class="editor-link">{m.editor_start_image_title()}</a
			>
			<a
				href="/video-editor"
				aria-current={kind === 'video' ? 'page' : undefined}
				class="editor-link">{m.editor_start_video_title()}</a
			>
		</nav>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			<LanguageSwitcher compact />
			{#if utility}{@render utility()}{/if}
		</div>
	</div>
</header>
<main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
	<div class="mb-8 flex flex-wrap items-center justify-between gap-5">
		<div class="flex min-w-0 items-center gap-4">
			<div class="min-w-0">
				<h1
					data-theme-type="title"
					data-app-title
					bind:this={heading}
					tabindex="-1"
					class="outline-none"
				>
					{title}
				</h1>
				<p class="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>
	</div>
	{@render children()}
</main>

<style>
	.editor-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.editor-link[aria-current],
	.editor-link:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	.editor-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
