<script lang="ts">
	import { getAuthenticatedMediaURL } from '$lib/media-url';

	let {
		mediaId,
		alt,
		thumbnailSize = 'md',
		class: className = ''
	}: {
		mediaId: string;
		alt: string;
		thumbnailSize?: 'sm' | 'md';
		class?: string;
	} = $props();

	const thumbnailURL = $derived(
		getAuthenticatedMediaURL(`/media/${mediaId}/thumb/${thumbnailSize}`)
	);
	const originalURL = $derived(getAuthenticatedMediaURL(`/media/${mediaId}`));

	function useOriginal(event: Event) {
		const image = event.currentTarget as HTMLImageElement;
		if (!image.src.includes('/thumb/')) return;
		image.src = originalURL;
	}
</script>

<img src={thumbnailURL} {alt} class={className} onerror={useOriginal} />
