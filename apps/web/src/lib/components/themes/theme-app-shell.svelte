<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { mode } from 'mode-watcher';

	import { resolvedThemeQueryOptions } from '@openpost/query-catalog';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { createThemeQueryAPI } from '$lib/query/themes';
	import { toWebResolvedTheme } from '$lib/themes/web-resolved';
	import ThemeApplicationBoundary from './theme-application-boundary.svelte';
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
	// Hold the last resolved theme across workspace or scheme changes so a
	// switch never flashes the Workshop fallback while the new query loads.
	// The boundary keeps the retained theme applied until fresh data arrives.
	let retainedTheme = $state<WebResolvedTheme | null>(null);
	$effect(() => {
		if (resolved.data) retainedTheme = toWebResolvedTheme(resolved.data);
	});
	let theme = $derived(retainedTheme);
</script>

<ThemeApplicationBoundary {active} scheme={effectiveScheme} {theme} />
