<script lang="ts">
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import * as Avatar from '$lib/components/ui/avatar';
	import { cn, getPlatformColor, getPlatformKey } from '$lib/utils';
	import { monogramFor } from '@openpost/ui/components/avatar/monogram.js';

	interface Props {
		name: string;
		platform: string;
		avatarUrl?: string | null;
		handle?: string | null;
		size?: 'sm' | 'default' | 'lg';
		class?: string;
		'data-testid'?: string;
	}

	let {
		name,
		platform,
		avatarUrl = '',
		handle = undefined,
		size = 'default',
		class: className = '',
		'data-testid': testId
	}: Props = $props();

	const fallback = $derived(monogramFor(name, handle));

	let loadedAvatarUrl = $state('');
	const avatarLoaded = $derived(Boolean(avatarUrl) && loadedAvatarUrl === avatarUrl);

	function handleAvatarLoad(event: Event) {
		const image = event.currentTarget;
		if (avatarUrl && image instanceof HTMLImageElement && image.getAttribute('src') === avatarUrl) {
			loadedAvatarUrl = avatarUrl;
		}
	}

	function handleAvatarError(event: Event) {
		const image = event.currentTarget;
		if (image instanceof HTMLImageElement && image.getAttribute('src') === avatarUrl) {
			loadedAvatarUrl = '';
		}
	}
</script>

<Avatar.Root {size} class={cn('overflow-visible', className)} data-testid={testId}>
	{#snippet child({ props })}
		<span {...props} aria-hidden="true">
			{#if avatarUrl}
				<img
					class={cn(
						'absolute inset-0 z-[1] aspect-square size-full rounded-full object-cover',
						avatarLoaded ? 'opacity-100' : 'opacity-0'
					)}
					src={avatarUrl}
					alt=""
					loading="lazy"
					referrerpolicy="no-referrer"
					onload={handleAvatarLoad}
					onerror={handleAvatarError}
				/>
			{/if}
			<Avatar.Fallback class={avatarLoaded ? 'invisible' : ''}>{fallback}</Avatar.Fallback>
			<!-- YouTube attribution belongs in the adjacent provider label, never a tiny badge. -->
			{#if getPlatformKey(platform) !== 'youtube'}
				<span
					class={cn(
						'absolute -right-0.5 -bottom-0.5 z-10 flex items-center justify-center rounded-full text-white ring-2 ring-background',
						getPlatformColor(platform),
						size === 'sm'
							? 'size-3 [&_svg]:size-2'
							: size === 'lg'
								? 'size-4 [&_svg]:size-2.5'
								: 'size-3.5 [&_svg]:size-2.5'
					)}
				>
					<PlatformIcon {platform} />
				</span>
			{/if}
		</span>
	{/snippet}
</Avatar.Root>
