<script lang="ts">
	import { postizSocialLogoSource, type PostizSocialLogo } from './postiz-social-logos';

	let {
		platform,
		alt = '',
		class: className
	}: { platform: PostizSocialLogo | 'youtube'; alt?: string; class?: string } = $props();
</script>

{#if platform === 'youtube'}
	<span class={className} data-youtube-text>YouTube</span>
{:else}
	<img
		class={className}
		src={postizSocialLogoSource(platform)}
		{alt}
		loading="lazy"
		decoding="async"
		fetchpriority="low"
	/>
{/if}

<style>
	[data-youtube-text] {
		display: inline-block;
		white-space: nowrap;
		font-size: 14px;
		line-height: 1.4;
		font-weight: 600;
	}
</style>
