<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import FileTextIcon from '@lucide/svelte/icons/files';
	import HomeIcon from '@lucide/svelte/icons/house';
	import ImageIcon from '@lucide/svelte/icons/images';
	import LifeBuoyIcon from '@lucide/svelte/icons/life-buoy';
	import SearchXIcon from '@lucide/svelte/icons/search-x';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	const documentationURL = 'https://docs.openpost.social/usage/';
	const supportURL = 'mailto:openpost@rgo.pt';
	let isNotFound = $derived(page.status === 404);
	let title = $derived(isNotFound ? m.app_not_found_title() : m.app_error_title());
	let description = $derived(
		isNotFound ? m.app_not_found_description() : m.app_error_description()
	);

	async function goBack() {
		if (window.history.length > 1) {
			window.history.back();
			return;
		}
		await goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>{page.status} — {title} — OpenPost</title>
</svelte:head>

{#snippet errorIcon()}
	<SearchXIcon class="size-6" />
{/snippet}

<StandaloneShell {title} {description} icon={errorIcon} maxWidth="lg" logoHref="/">
	<div class="space-y-6" data-testid="app-error-page">
		<p class="text-center font-mono text-xs text-muted-foreground">HTTP {page.status}</p>

		<div class="grid gap-2 sm:grid-cols-2">
			<Button variant="secondary" class="w-full" onclick={goBack}>
				<ArrowLeftIcon data-icon="inline-start" />
				{m.common_back()}
			</Button>
			<Button href={resolve('/')} class="w-full">
				<HomeIcon data-icon="inline-start" />
				{m.app_error_home()}
			</Button>
		</div>

		<nav aria-label={m.app_error_destinations()}>
			<p class="mb-2 text-sm font-medium">{m.app_error_destinations()}</p>
			<div class="grid gap-2 sm:grid-cols-2">
				<Button href={resolve('/')} variant="outline" class="w-full justify-start">
					<SquarePenIcon data-icon="inline-start" />
					{m.sidebar_new_post()}
				</Button>
				<Button href={resolve('/activity')} variant="outline" class="w-full justify-start">
					<FileTextIcon data-icon="inline-start" />
					{m.sidebar_activity()}
				</Button>
				<Button href={resolve('/calendar')} variant="outline" class="w-full justify-start">
					<CalendarIcon data-icon="inline-start" />
					{m.sidebar_calendar()}
				</Button>
				<Button href={resolve('/media')} variant="outline" class="w-full justify-start">
					<ImageIcon data-icon="inline-start" />
					{m.sidebar_media()}
				</Button>
			</div>
		</nav>

		<div class="flex flex-wrap justify-center gap-x-5 gap-y-2 border-t pt-4 text-sm">
			<a
				href={documentationURL}
				target="_blank"
				rel="noreferrer"
				class="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
			>
				<FileTextIcon class="size-4" aria-hidden="true" />
				{m.app_error_documentation()}
			</a>
			<a
				href={supportURL}
				class="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
			>
				<LifeBuoyIcon class="size-4" aria-hidden="true" />
				{m.app_error_support()}
			</a>
		</div>
	</div>
</StandaloneShell>
