<script lang="ts">
	import { postizSocialLogoSource, type PostizSocialLogo } from './postiz-social-logos';

	let {
		platform,
		alt = '',
		class: className
	}: { platform: PostizSocialLogo; alt?: string; class?: string } = $props();
</script>

<img
	class={className}
	src={postizSocialLogoSource(platform)}
	{alt}
	loading="lazy"
	decoding="async"
/>
