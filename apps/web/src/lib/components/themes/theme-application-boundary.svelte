<script lang="ts">
	import { getApplicationThemePreview } from '$lib/themes/application-preview.svelte';
	import { onDestroy } from 'svelte';
	import { WebThemeRuntime } from '$lib/themes/runtime';
	import type { ThemeScheme, WebResolvedTheme } from '$lib/themes/contracts';
	import { resolveWorkshopTheme } from '$lib/themes/workshop';

	let {
		active,
		scheme,
		theme,
		runtime = new WebThemeRuntime()
	}: {
		active: boolean;
		scheme: ThemeScheme;
		theme: WebResolvedTheme | null;
		runtime?: WebThemeRuntime;
	} = $props();

	const preview = getApplicationThemePreview();

	$effect(() => {
		if (!('document' in globalThis)) return;
		const root = globalThis.document.documentElement;
		if (!active) {
			runtime.clear(root);
			return;
		}
		void runtime.apply(preview?.theme ?? theme ?? unavailableTheme(scheme), root);
	});

	onDestroy(() => {
		if ('document' in globalThis) runtime.clear(globalThis.document.documentElement);
	});

	function unavailableTheme(requestedScheme: ThemeScheme): WebResolvedTheme {
		return {
			...resolveWorkshopTheme(requestedScheme),
			source: 'fallback',
			fallbackReason: 'missing-theme'
		};
	}
</script>
