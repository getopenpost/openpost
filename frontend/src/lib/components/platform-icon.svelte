<script lang="ts">
	import x from '../../../../assets/logos/x.svg?raw';
	import mastodon from '../../../../assets/logos/mastodon.svg?raw';
	import threads from '../../../../assets/logos/threads.svg?raw';
	import bluesky from '../../../../assets/logos/bluesky.svg?raw';
	import linkedin from '../../../../assets/logos/linkedin.svg?raw';
	import instagram from '../../../../assets/logos/instagram.svg?raw';
	import facebook from '../../../../assets/logos/facebook.svg?raw';
	import youtube from '../../../../assets/logos/youtube.svg?raw';
	import tiktok from '../../../../assets/logos/tiktok.svg?raw';
	import { getPlatformKey } from '$lib/utils';

	interface Props {
		platform: string;
		class?: string;
	}

	let { platform, class: className = '' }: Props = $props();

	const svgs: Record<string, string> = {
		x,
		mastodon,
		threads,
		bluesky,
		linkedin,
		instagram,
		facebook,
		youtube,
		tiktok
	};
	const platformKey = $derived(getPlatformKey(platform));

	const svg = $derived(
		svgs[platformKey] ? svgs[platformKey].replace('<svg ', `<svg class="${className}" `) : ''
	);
</script>

{#if svg}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html svg}
{/if}
