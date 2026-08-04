<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import MarketingFooter from './_components/MarketingFooter.svelte';
	import MarketingNav from './_components/MarketingNav.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<meta property="og:site_name" content="OpenPost" />
	<meta property="og:type" content="website" />
	<meta property="og:image" content="https://openpost.social/assets/brand/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="OpenPost social publishing workspace." />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content="https://openpost.social/assets/brand/og-image.png" />
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
