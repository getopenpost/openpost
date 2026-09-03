<script module lang="ts">
	export { THEME_PREVIEW_SCENES } from './theme-preview-types.js';
	export type ThemePreviewScene = import('./theme-preview-types.js').ThemePreviewScene;
	export type ThemePreviewViewport = import('./theme-preview-types.js').ThemePreviewViewport;
</script>

<script lang="ts">
	import { mount, onMount, unmount, untrack } from 'svelte';
	import { getCurrentLocale, onLocaleChange } from '$lib/i18n';
	import type { Locale } from '$lib/paraglide/runtime';
	import {
		mountThemePreviewDocument,
		type ThemePreviewDocument,
		type WebThemeRuntime,
		type WebResolvedTheme
	} from '$lib/themes';
	import ThemePreviewSceneContent from './theme-preview-scene.svelte';
	import type {
		ThemePreviewScene as ThemePreviewSceneValue,
		ThemePreviewViewport as ThemePreviewViewportValue
	} from './theme-preview-types.js';

	interface Props {
		theme: WebResolvedTheme;
		scene?: ThemePreviewSceneValue;
		viewport?: ThemePreviewViewportValue;
		label: string;
		interactive?: boolean;
		runtime?: WebThemeRuntime;
		locale?: Locale;
		class?: string;
	}

	let {
		theme,
		scene = 'dashboard',
		viewport = 'desktop',
		label,
		interactive = false,
		runtime,
		locale: requestedLocale,
		class: className = ''
	}: Props = $props();

	let activeLocale = $state(untrack(() => requestedLocale ?? getCurrentLocale()));
	let frame: HTMLIFrameElement | undefined = $state();
	let preview: ThemePreviewDocument | undefined = $state();
	let sceneInstance: ReturnType<typeof mount> | undefined;
	let documentGeneration = 0;
	let applyGeneration = 0;
	let ready = $state(false);
	const sceneProps = $state<{
		theme: WebResolvedTheme;
		scene: ThemePreviewSceneValue;
		interactive: boolean;
		locale: Locale;
	}>({
		theme: untrack(() => theme),
		scene: untrack(() => scene),
		interactive: untrack(() => interactive),
		locale: untrack(() => activeLocale)
	});

	const viewportWidth = $derived(
		viewport === 'phone-small' ? '20rem' : viewport === 'phone' ? '24.375rem' : '100%'
	);
	const themeFingerprint = $derived(JSON.stringify(theme));

	$effect(() => {
		sceneProps.scene = scene;
		sceneProps.interactive = interactive;
		sceneProps.locale = activeLocale;
	});
	$effect(() => {
		if (requestedLocale) activeLocale = requestedLocale;
	});
	onMount(() =>
		onLocaleChange((locale) => {
			if (!requestedLocale) activeLocale = locale;
		})
	);

	function applyTheme(mountedPreview: ThemePreviewDocument, nextTheme: WebResolvedTheme) {
		const generation = ++applyGeneration;
		ready = false;
		void mountedPreview.apply(nextTheme).then((applied) => {
			if (generation !== applyGeneration || !applied) return;
			sceneProps.theme = nextTheme;
			ready = true;
		});
	}

	$effect(() => {
		const target = frame;
		if (!target) return;
		const initialTheme = untrack(() => theme);
		const generation = ++documentGeneration;
		ready = false;

		void mountThemePreviewDocument(target, { runtime })
			.then((mountedPreview) => {
				if (generation !== documentGeneration) {
					mountedPreview.destroy();
					return;
				}
				sceneProps.theme = initialTheme;
				sceneInstance = mount(ThemePreviewSceneContent, {
					target: mountedPreview.root,
					props: sceneProps
				});
				preview = mountedPreview;
			})
			.catch(() => {
				if (generation === documentGeneration) ready = false;
			});

		return () => {
			documentGeneration += 1;
			applyGeneration += 1;
			if (sceneInstance) void unmount(sceneInstance);
			sceneInstance = undefined;
			preview?.destroy();
			preview = undefined;
		};
	});

	$effect(() => {
		void themeFingerprint;
		const mountedPreview = preview;
		const nextTheme = theme;
		if (!mountedPreview) return;
		applyTheme(mountedPreview, nextTheme);
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (phone previews need keyboard-scrollable overflow) -->
<div
	class={[
		'theme-preview-frame min-h-0 w-full overflow-x-auto overflow-y-hidden rounded-[var(--theme-radius-lg,var(--radius))] bg-muted/50 p-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none sm:p-3',
		className
	]}
	role={viewport === 'desktop' ? undefined : 'region'}
	aria-label={viewport === 'desktop' ? undefined : label}
	tabindex={viewport === 'desktop' ? undefined : 0}
	data-preview-viewport={viewport}
>
	<iframe
		bind:this={frame}
		title={label}
		style:width={viewportWidth}
		class="mx-auto block h-[30rem] max-w-none overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-background shadow-[var(--theme-shadow-card,none)] transition-[width,opacity] duration-200"
		class:opacity-70={!ready}
		aria-busy={!ready}
		data-testid="theme-preview"
	></iframe>
</div>
