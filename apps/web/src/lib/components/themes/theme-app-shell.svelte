<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { mode } from 'mode-watcher';
	import { captureClientException } from '@openpost/telemetry';

	import { resolvedThemeQueryOptions } from '@openpost/query-catalog';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { createThemeQueryAPI } from '$lib/query/themes';
	import { toWebResolvedTheme } from '$lib/themes/web-resolved';
	import type { ThemeScheme, WebResolvedTheme } from '$lib/themes';

	const themeApi = createThemeQueryAPI();

	let authState = $derived($auth);
	let workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');

	// The API resolves light or dark only, so the user's system preference is
	// turned into an effective scheme here before it reaches the resolver.
	let systemDark = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const query = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = query.matches;
		const onChange = (event: MediaQueryListEvent) => (systemDark = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});

	let preferredMode = $derived(mode.current ?? 'system');
	let effectiveScheme: ThemeScheme = $derived(
		preferredMode === 'dark' || (preferredMode === 'system' && systemDark) ? 'dark' : 'light'
	);

	const resolved = createQuery(() =>
		resolvedThemeQueryOptions(themeApi, workspaceID, effectiveScheme)
	);

	let active = $derived(
		typeof document !== 'undefined' && authState.isAuthenticated && Boolean(workspaceID)
	);
	let ThemeApplicationBoundary = $state<
		typeof import('./theme-application-boundary.svelte').default | null
	>(null);
	$effect(() => {
		if (!active || ThemeApplicationBoundary) return;
		let current = true;
		void import('./theme-application-boundary.svelte')
			.then((module) => {
				if (current) ThemeApplicationBoundary = module.default;
			})
			.catch((error) => {
				// The complete CSS fallback keeps the app usable if the theme download fails.
				captureClientException(error, { error_boundary: 'theme_startup' });
			});
		return () => {
			current = false;
		};
	});
	// Hold the last resolved theme across workspace or scheme changes so a
	// switch never flashes the Workshop fallback while the new query loads.
	// The boundary keeps the retained theme applied until fresh data arrives.
	let retainedTheme = $state<WebResolvedTheme | null>(null);
	$effect(() => {
		if (resolved.data) retainedTheme = toWebResolvedTheme(resolved.data);
	});
	let theme = $derived(retainedTheme);
</script>

{#if active && ThemeApplicationBoundary}
	<ThemeApplicationBoundary {active} scheme={effectiveScheme} {theme} />
{/if}
