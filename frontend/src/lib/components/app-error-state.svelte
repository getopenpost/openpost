<script lang="ts">
	import { tick } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import FileTextIcon from '@lucide/svelte/icons/files';
	import HomeIcon from '@lucide/svelte/icons/house';
	import ImageIcon from '@lucide/svelte/icons/images';
	import LifeBuoyIcon from '@lucide/svelte/icons/life-buoy';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import ServerCrashIcon from '@lucide/svelte/icons/server-crash';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import WifiOffIcon from '@lucide/svelte/icons/wifi-off';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { resolveAppErrorProjection } from '$lib/app-error-presentation';

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
		documentationURL = 'https://docs.openpost.social/usage/',
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
			<WifiOffIcon class="size-6" />
		{:else if presentation.icon === 'forbidden'}
			<ShieldAlertIcon class="size-6" />
		{:else if presentation.icon === 'not-found'}
			<SearchXIcon class="size-6" />
		{:else if presentation.icon === 'request-error'}
			<CircleAlertIcon class="size-6" />
		{:else}
			<ServerCrashIcon class="size-6" />
		{/if}
	{/snippet}

	<StandaloneShell {title} {description} icon={errorIcon} maxWidth="lg" logoHref="/">
		<div class="space-y-6">
			<p class="text-center font-mono text-xs text-muted-foreground">HTTP {status}</p>

			<div class="grid gap-2 sm:grid-cols-2">
				<Button variant="secondary" class="min-h-11 w-full" onclick={onBack}>
					<ArrowLeftIcon data-icon="inline-start" />
					{m.common_back()}
				</Button>
				{#if recovery.canRetry}
					<Button class="min-h-11 w-full" disabled={!online || retrying} onclick={retry}>
						<RefreshIcon data-icon="inline-start" class={retrying ? 'animate-spin' : ''} />
						{retrying ? m.app_error_retrying() : m.common_retry()}
					</Button>
				{:else}
					<Button href={links.home} class="min-h-11 w-full">
						<HomeIcon data-icon="inline-start" />
						{m.app_error_home()}
					</Button>
				{/if}
			</div>

			{#if recovery.showDestinations}
				<nav aria-label={m.app_error_destinations()}>
					<p class="mb-2 text-sm font-medium">{m.app_error_destinations()}</p>
					<div class="grid gap-2 sm:grid-cols-2">
						<Button href={links.home} variant="outline" class="min-h-11 w-full justify-start">
							<SquarePenIcon data-icon="inline-start" />
							{m.sidebar_new_post()}
						</Button>
						<Button href={links.activity} variant="outline" class="min-h-11 w-full justify-start">
							<FileTextIcon data-icon="inline-start" />
							{m.sidebar_activity()}
						</Button>
						<Button href={links.calendar} variant="outline" class="min-h-11 w-full justify-start">
							<CalendarIcon data-icon="inline-start" />
							{m.sidebar_calendar()}
						</Button>
						<Button href={links.media} variant="outline" class="min-h-11 w-full justify-start">
							<ImageIcon data-icon="inline-start" />
							{m.sidebar_media()}
						</Button>
					</div>
				</nav>
			{/if}

			{#if recovery.showDocumentation || recovery.showSupport || recovery.canRetry}
				<div class="flex flex-wrap justify-center gap-x-5 gap-y-2 border-t pt-4 text-sm">
					{#if recovery.canRetry}
						<Button href={links.home} variant="link" class="min-h-11 px-0">
							<HomeIcon class="size-4" aria-hidden="true" />
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
							<FileTextIcon class="size-4" aria-hidden="true" />
							{m.app_error_documentation()}
						</Button>
					{/if}
					{#if recovery.showSupport}
						<Button href={supportURL} variant="link" class="min-h-11 px-0">
							<LifeBuoyIcon class="size-4" aria-hidden="true" />
							{m.app_error_support()}
						</Button>
					{/if}
				</div>
			{/if}
		</div>
	</StandaloneShell>
</div>
