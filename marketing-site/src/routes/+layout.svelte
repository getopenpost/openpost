<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { marketingAgentMarkdownUrl, resolveMarketingSocial } from '@openpost/social-images';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import {
		captureTelemetryPageView,
		configureTelemetry,
		installGlobalErrorCapture
	} from '@openpost/telemetry';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import MarketingFooter from './_components/MarketingFooter.svelte';
	import MarketingNav from './_components/MarketingNav.svelte';
	import { structuredDataForMarketingPage } from './_structured-data';

	let { children } = $props();
	const social = $derived(resolveMarketingSocial(page.url.pathname));
	const socialImage = $derived(social.imageUrl);
	const agentMarkdown = $derived(marketingAgentMarkdownUrl(social));
	const structuredData = $derived(structuredDataForMarketingPage(social));
	const structuredDataJSON = $derived(JSON.stringify(structuredData).replaceAll('<', '\\u003c'));

	afterNavigate((navigation) => {
		captureTelemetryPageView(navigation.to?.route.id ?? '/unknown');
	});

	onMount(() => {
		soundPreferences.initialize();
		configureTelemetry({
			enabled: Boolean(
				import.meta.env.VITE_POSTHOG_PROJECT_TOKEN && import.meta.env.VITE_POSTHOG_API_HOST
			),
			projectToken: import.meta.env.VITE_POSTHOG_PROJECT_TOKEN,
			apiHost: import.meta.env.VITE_POSTHOG_API_HOST,
			uiHost: import.meta.env.VITE_POSTHOG_UI_HOST,
			environment: import.meta.env.VITE_OPENPOST_ENVIRONMENT || 'development',
			edition: 'public',
			version: import.meta.env.VITE_OPENPOST_VERSION,
			revision: import.meta.env.VITE_OPENPOST_REVISION,
			surface: 'marketing'
		});
		return installGlobalErrorCapture();
	});
</script>

<svelte:head>
	<title>{social.title}</title>
	<meta name="description" content={social.description} />
	<link rel="canonical" href={social.canonical} />
	<link
		rel="alternate"
		type="application/atom+xml"
		href="https://openpost.social/changelog.xml"
		title="OpenPost changelog"
	/>
	<meta name="robots" content="index, follow" />
	<meta property="og:site_name" content="OpenPost" />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={social.socialTitle} />
	<meta property="og:description" content={social.description} />
	<meta property="og:url" content={social.canonical} />
	<meta property="og:image" content={socialImage} />
	<meta property="og:image:secure_url" content={socialImage} />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content={social.imageAlt} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={social.socialTitle} />
	<meta name="twitter:description" content={social.description} />
	<meta name="twitter:image" content={socialImage} />
	<meta name="twitter:image:alt" content={social.imageAlt} />
	{#if agentMarkdown}
		<link rel="alternate" type="text/markdown" href={agentMarkdown} />
		<link
			rel="alternate"
			type="text/plain"
			href="https://openpost.social/llms.txt"
			title="llms.txt"
		/>
	{/if}
	<!-- SAFETY: JSON is built only from maintained route and product constants; '<' is escaped above. -->
	{@html `<script type="application/ld+json">${structuredDataJSON}<\/script>`}
</svelte:head>

<ModeWatcher
	defaultMode="system"
	synchronousModeChanges
	themeColors={{
		light: 'oklch(0.985 0.002 80)',
		dark: 'oklch(0.145 0.008 55)'
	}}
/>

<a
	href="#main-content"
	class="sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:block focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg"
>
	Skip to content
</a>

<div class="min-h-screen bg-background text-foreground">
	<MarketingNav />
	<main id="main-content">
		{@render children()}
	</main>
	<MarketingFooter />
</div>
