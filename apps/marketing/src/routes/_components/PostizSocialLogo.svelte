<script lang="ts">
	import youtubeIcon from '../../../../../assets/logos/youtube.svg?url';
	import { postizSocialLogoSource, type PostizSocialLogo } from './postiz-social-logos';

	let {
		platform,
		alt = '',
		class: className
	}: { platform: PostizSocialLogo | 'youtube'; alt?: string; class?: string } = $props();
</script>

{#if platform === 'youtube'}
	<img
		class={['youtube-brand', className]}
		src={youtubeIcon}
		{alt}
		width={56}
		height={48}
		loading="lazy"
		decoding="async"
	/>
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
	/* Preserve the official clear space around the audit's roughly 26px painted icon. */
	.youtube-brand {
		width: 56px;
		height: 48px;
		min-width: 56px;
		min-height: 48px;
		max-width: none;
		flex-shrink: 0;
		object-fit: contain;
	}
</style>
