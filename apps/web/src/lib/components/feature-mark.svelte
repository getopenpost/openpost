<script module lang="ts">
	const featureMarkSources = {
		compose: '/assets/brand/features/compose.svg',
		'image-editor': '/assets/brand/features/image-editor.svg',
		'video-editor': '/assets/brand/features/video-editor.svg',
		calendar: '/assets/brand/features/calendar.svg',
		analytics: '/assets/brand/features/analytics.svg',
		media: '/assets/brand/features/media.svg',
		inbox: '/assets/brand/features/inbox.svg',
		accounts: '/assets/brand/features/accounts.svg',
		recorder: '/assets/brand/features/recorder.svg',
		ideas: '/assets/brand/features/ideas.svg',
		automation: '/assets/brand/features/automation.svg',
		grow: '/assets/brand/features/grow.svg',
		repost: '/assets/brand/features/repost.svg',
		workspaces: '/assets/brand/features/workspaces.svg',
		memes: '/assets/brand/features/memes.svg'
	} as const;

	export type FeatureMarkName = keyof typeof featureMarkSources;
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		name,
		size = 28,
		class: className
	}: {
		name: FeatureMarkName;
		size?: number;
		class?: string;
	} = $props();
</script>

<img
	src={featureMarkSources[name]}
	alt=""
	aria-hidden="true"
	width={size}
	height={size}
	class={cn('shrink-0 object-contain', className)}
/>
