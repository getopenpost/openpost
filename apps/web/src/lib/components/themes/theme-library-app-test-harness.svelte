<script lang="ts">
	import { provideApplicationThemePreview } from '$lib/themes/application-preview.svelte';
	import ThemeApplicationBoundary from './theme-application-boundary.svelte';
	import ThemeLibrary from './theme-library.svelte';
	import { resolveBuiltInTheme, WebThemeRuntime } from '$lib/themes';

	provideApplicationThemePreview();
	let { showLibrary = true } = $props();
	const runtime = new WebThemeRuntime({
		stageFonts: async () => ({ release: () => undefined }),
		loadAssets: async () => undefined,
		loadIconPack: async () => undefined,
		setBrowserSurface: () => () => undefined
	});
</script>

<ThemeApplicationBoundary
	active={true}
	scheme="light"
	theme={resolveBuiltInTheme('workshop', 'light')}
	{runtime}
/>
{#if showLibrary}<ThemeLibrary scheme="light" />{/if}
