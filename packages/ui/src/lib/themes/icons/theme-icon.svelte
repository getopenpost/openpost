<script lang="ts">
	import { onMount } from 'svelte';
	import type { SVGAttributes } from 'svelte/elements';
	import { THEME_ICON_PACK_IDS, type ThemeIconPackId, type ThemeIconRole } from '../contracts.js';
	import { getThemeIcon, loadThemeIcon } from './registry.js';
	import type { ThemeIconData } from './types.js';

	type Props = Omit<SVGAttributes<SVGSVGElement>, 'role'> & {
		role: ThemeIconRole;
		pack?: ThemeIconPackId;
		label?: string;
	};

	let {
		role,
		pack,
		label,
		class: className,
		width = '1em',
		height = '1em',
		...restProps
	}: Props = $props();
	// Icons that point along the reading direction mirror in right-to-left
	// text. style.css mirrors them with :dir(rtl), which follows the nearest
	// dir attribute, so left-to-right regions such as timelines keep them.
	const MIRRORED_ROLES: ReadonlySet<ThemeIconRole> = new Set([
		'arrow-left',
		'arrow-right',
		'chevron-left',
		'chevron-right',
		'logout',
		'redo',
		'reply',
		'send',
		'undo'
	]);
	let element = $state<SVGSVGElement>();
	let inheritedPack = $state<ThemeIconPackId>('lucide');
	let loadedIcon = $state<ThemeIconData>();
	let request = 0;
	const selectedPack = $derived(pack ?? inheritedPack);
	const icon = $derived(loadedIcon ?? getThemeIcon(selectedPack, role));

	function isThemeIconPackId(value: string | null): value is ThemeIconPackId {
		return value !== null && THEME_ICON_PACK_IDS.some((candidate) => candidate === value);
	}

	function themePackFromScope(): ThemeIconPackId {
		const raw = element?.closest('[data-theme-icon-pack]')?.getAttribute('data-theme-icon-pack');
		return raw && isThemeIconPackId(raw) ? raw : 'lucide';
	}

	onMount(() => {
		if (pack) return;
		inheritedPack = themePackFromScope();
		const scope = element?.closest('[data-theme-icon-pack]') ?? document.documentElement;
		const observer = new MutationObserver(() => {
			inheritedPack = themePackFromScope();
		});
		observer.observe(scope, {
			attributes: true,
			attributeFilter: ['data-theme-icon-pack']
		});
		const handleThemeChange = () => {
			inheritedPack = themePackFromScope();
		};
		document.addEventListener('openpost:themechange', handleThemeChange);
		return () => {
			observer.disconnect();
			document.removeEventListener('openpost:themechange', handleThemeChange);
		};
	});

	$effect(() => {
		const currentRequest = ++request;
		loadedIcon = undefined;
		loadThemeIcon(selectedPack, role).then(
			(loaded) => {
				if (currentRequest === request) loadedIcon = loaded;
			},
			() => {
				if (currentRequest === request) loadedIcon = getThemeIcon('lucide', role);
			}
		);
	});
</script>

<svg
	bind:this={element}
	class={className}
	{width}
	{height}
	viewBox={icon.viewBox}
	fill="currentColor"
	xmlns="http://www.w3.org/2000/svg"
	focusable="false"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	data-theme-icon={role}
	data-mirror-rtl={MIRRORED_ROLES.has(role) ? '' : undefined}
	data-icon-pack={selectedPack}
	{...restProps}
>
	<!-- Icon bodies are compiled from pinned, local Iconify JSON packages. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html icon.body}
</svg>
