<script lang="ts">
	import { getAuthenticatedMediaURL } from '$lib/media-url';

	let {
		mediaId,
		alt,
		thumbnailSize = 'md',
		class: className = '',
		onMissing
	}: {
		mediaId: string;
		alt: string;
		thumbnailSize?: 'sm' | 'md';
		class?: string;
		onMissing?: () => void;
	} = $props();
	let originalAttemptedFor = $state('');

	const thumbnailURL = $derived(
		getAuthenticatedMediaURL(`/media/${mediaId}/thumb/${thumbnailSize}`)
	);
	const originalURL = $derived(getAuthenticatedMediaURL(`/media/${mediaId}`));

	function useOriginal(event: Event) {
		const image = event.currentTarget as HTMLImageElement;
		if (originalAttemptedFor !== mediaId && image.src.includes('/thumb/')) {
			originalAttemptedFor = mediaId;
			image.src = originalURL;
			return;
		}
		onMissing?.();
	}
</script>

<img src={thumbnailURL} {alt} class={className} onerror={useOriginal} />
