<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		resolveBuiltInTheme,
		WebThemeRuntime,
		type ThemeScheme,
		type WebResolvedTheme
	} from '$lib/themes';

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

	$effect(() => {
		if (!('document' in globalThis)) return;
		const root = globalThis.document.documentElement;
		if (!active) {
			runtime.clear(root);
			return;
		}
		void runtime.apply(theme ?? unavailableTheme(scheme), root);
	});

	onDestroy(() => {
		if ('document' in globalThis) runtime.clear(globalThis.document.documentElement);
	});

	function unavailableTheme(requestedScheme: ThemeScheme): WebResolvedTheme {
		return {
			...resolveBuiltInTheme('workshop', requestedScheme),
			source: 'fallback',
			fallbackReason: 'missing-theme'
		};
	}
</script>
