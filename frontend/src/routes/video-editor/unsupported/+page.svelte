<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { m } from '$lib/paraglide/messages';
	import { detectVideoEditorCapabilities } from '$lib/video-editor/capabilities';
	import type { VideoEditorCapabilities } from '$lib/video-editor/types';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';

	let capabilities = $state<VideoEditorCapabilities | null>(null);

	onMount(() => {
		void detectVideoEditorCapabilities().then((result) => (capabilities = result));
	});

	const checks = $derived(
		capabilities
			? [
					['WebCodecs', capabilities.webCodecs],
					['H.264', capabilities.h264Encoder],
					['AAC', capabilities.aacEncoder],
					['WebGL2', capabilities.webgl2],
					['OPFS', capabilities.opfs],
					['Screen Capture', capabilities.screenCapture],
					['Desktop timeline', capabilities.desktopTimeline]
				]
			: []
	);
</script>

<svelte:head><title>{m.video_editor_unsupported()} — OpenPost</title></svelte:head>

<main class="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6">
	<div class="mx-auto max-w-2xl">
		<a
			href={resolve('/')}
			class="inline-flex min-h-11 items-center"
			aria-label={m.common_openpost()}
		>
			<Logo width={112} height={33} />
		</a>
		<h1 class="mt-10 text-2xl font-semibold tracking-tight">{m.video_editor_unsupported()}</h1>
		<p class="mt-3 leading-7 text-muted-foreground">{m.video_editor_unsupported_body()}</p>
		<InlineNotice class="mt-5" tone="info" message={m.video_editor_unsupported_mobile()} />

		<div class="mt-8 divide-y rounded-lg border">
			{#each checks as check (check[0])}
				<div class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
					<span>{check[0]}</span>
					{#if check[1]}
						<CheckIcon
							class="size-4 text-emerald-600"
							aria-label={m.video_editor_status_enabled()}
						/>
					{:else}
						<XIcon class="size-4 text-destructive" aria-label={m.video_editor_status_disabled()} />
					{/if}
				</div>
			{/each}
		</div>

		<div class="mt-8 flex flex-wrap gap-2">
			<Button href="/video-editor">{m.video_editor_back()}</Button>
			<Button
				href="https://www.google.com/chrome/"
				target="_blank"
				rel="noreferrer"
				variant="outline"
			>
				{m.video_editor_supported_guidance()}
			</Button>
		</div>
	</div>
</main>
