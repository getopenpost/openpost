<script lang="ts">
	import { tick } from 'svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { resolveAppErrorProjection } from '$lib/app-error-presentation';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	interface Props {
		status: number;
		online: boolean;
		onBack: () => void | Promise<void>;
		onRetry: () => void | Promise<void>;
		documentationURL?: string;
		supportURL?: string;
		links?: {
			home: string;
			activity: string;
			calendar: string;
			media: string;
		};
	}

	let {
		status,
		online,
		onBack,
		onRetry,
		documentationURL = 'https://docs.openpo.st/usage/',
		supportURL = 'mailto:openpost@rgo.pt',
		links = {
			home: '/',
			activity: '/publications',
			calendar: '/calendar',
			media: '/media'
		}
	}: Props = $props();

	let root: HTMLDivElement;
	let retrying = $state(false);
	const error = $derived(resolveAppErrorProjection(status, online));
	const recovery = $derived(error.recovery);
	const presentation = $derived(error.presentation);
	const title = $derived(presentation.title);
	const description = $derived(presentation.description);
	$effect(() => {
		if (!title) return;
		void focusHeading();
	});

	async function focusHeading() {
		await tick();
		const heading = root?.querySelector<HTMLHeadingElement>('h1');
		if (!heading) return;
		heading.tabIndex = -1;
		heading.focus();
	}

	async function retry() {
		if (retrying || !online) return;
		retrying = true;
		try {
			await onRetry();
		} finally {
			retrying = false;
		}
	}
</script>

<div bind:this={root} data-testid="app-error-page">
	{#snippet errorIcon()}
		{#if presentation.icon === 'offline'}
			<ThemeIcon role="communications" class="size-6" />
		{:else if presentation.icon === 'forbidden'}
			<ThemeIcon role="security" class="size-6" />
		{:else if presentation.icon === 'not-found'}
			<ThemeIcon role="search" class="size-6" />
		{:else}
			<ProtectedIcon icon="error" class="size-6" />
		{/if}
	{/snippet}

	<StandaloneShell {title} {description} icon={errorIcon} maxWidth="lg" logoHref="/">
		<div class="space-y-6">
			<p class="text-center font-mono text-xs text-muted-foreground">HTTP {status}</p>

			<div class="grid gap-2 sm:grid-cols-2">
				<Button variant="secondary" class="min-h-11 w-full" onclick={onBack}>
					<ThemeIcon role="arrow-left" data-icon="inline-start" />
					{m.common_back()}
				</Button>
				{#if recovery.canRetry}
					<Button class="min-h-11 w-full" disabled={!online || retrying} onclick={retry}>
						<ThemeIcon
							role="refresh"
							data-icon="inline-start"
							class={retrying ? 'animate-spin' : ''}
						/>
						{retrying ? m.app_error_retrying() : m.common_retry()}
					</Button>
				{:else}
					<Button href={links.home} class="min-h-11 w-full">
						<ThemeIcon role="home" data-icon="inline-start" />
						{m.app_error_home()}
					</Button>
				{/if}
			</div>

			{#if recovery.showDestinations}
				<nav aria-label={m.app_error_destinations()}>
					<p class="mb-2 text-sm font-medium">{m.app_error_destinations()}</p>
					<div class="grid gap-2 sm:grid-cols-2">
						<Button href={links.home} variant="outline" class="min-h-11 w-full justify-start">
							<ThemeIcon role="compose" data-icon="inline-start" />
							{m.sidebar_new_post()}
						</Button>
						<Button href={links.activity} variant="outline" class="min-h-11 w-full justify-start">
							<ThemeIcon role="publications" data-icon="inline-start" />
							{m.sidebar_activity()}
						</Button>
						<Button href={links.calendar} variant="outline" class="min-h-11 w-full justify-start">
							<ThemeIcon role="calendar" data-icon="inline-start" />
							{m.sidebar_calendar()}
						</Button>
						<Button href={links.media} variant="outline" class="min-h-11 w-full justify-start">
							<ThemeIcon role="media" data-icon="inline-start" />
							{m.sidebar_media()}
						</Button>
					</div>
				</nav>
			{/if}

			{#if recovery.showDocumentation || recovery.showSupport || recovery.canRetry}
				<div class="flex flex-wrap justify-center gap-x-5 gap-y-2 border-t pt-4 text-sm">
					{#if recovery.canRetry}
						<Button href={links.home} variant="link" class="min-h-11 px-0">
							<ThemeIcon role="home" class="size-4" />
							{m.app_error_home()}
						</Button>
					{/if}
					{#if recovery.showDocumentation}
						<Button
							href={documentationURL}
							target="_blank"
							rel="noreferrer"
							variant="link"
							class="min-h-11 px-0"
						>
							<ThemeIcon role="file" class="size-4" />
							{m.app_error_documentation()}
						</Button>
					{/if}
					{#if recovery.showSupport}
						<Button href={supportURL} variant="link" class="min-h-11 px-0">
							<ThemeIcon role="help" class="size-4" />
							{m.app_error_support()}
						</Button>
					{/if}
				</div>
			{/if}
		</div>
	</StandaloneShell>
</div>
