<script lang="ts">
	import x from '../../../../../assets/logos/x.svg?raw';
	import mastodon from '../../../../../assets/logos/mastodon.svg?raw';
	import threads from '../../../../../assets/logos/threads.svg?raw';
	import bluesky from '../../../../../assets/logos/bluesky.svg?raw';
	import discord from '../../../../../assets/logos/discord.svg?raw';
	import linkedin from '../../../../../assets/logos/linkedin.svg?raw';
	import instagram from '../../../../../assets/logos/instagram.svg?raw';
	import facebook from '../../../../../assets/logos/facebook.svg?raw';
	import youtube from '../../../../../assets/logos/youtube.svg?raw';
	import tiktok from '../../../../../assets/logos/tiktok.svg?raw';
	import pinterest from '../../../../../assets/logos/pinterest.svg?raw';
	import telegram from '../../../../../assets/logos/telegram.svg?raw';
	import { getPlatformKey } from '$lib/utils';
	import { ThemeIcon } from '$lib/themes/icons';

	interface Props {
		platform: string;
		class?: string;
	}

	let { platform, class: className = '' }: Props = $props();

	const svgs = new Map<string, string>([
		['x', x],
		['mastodon', mastodon],
		['threads', threads],
		['bluesky', bluesky],
		['discord', discord],
		['linkedin', linkedin],
		['instagram', instagram],
		['facebook', facebook],
		['youtube', youtube],
		['tiktok', tiktok],
		['pinterest', pinterest],
		['telegram', telegram]
	]);
	const platformKey = $derived(getPlatformKey(platform));

	const svg = $derived(svgs.get(platformKey)?.replace('<svg ', `<svg class="${className}" `) ?? '');
</script>

{#if svg}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html svg}
{:else}
	<ThemeIcon role="plugin" class={className} aria-hidden="true" />
{/if}
