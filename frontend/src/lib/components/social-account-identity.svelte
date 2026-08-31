<script lang="ts">
	import SocialAccountAvatar from '$lib/components/social-account-avatar.svelte';
	import { cn, getPlatformName } from '$lib/utils';

	interface Props {
		name: string;
		platform: string;
		platformLabel?: string;
		avatarUrl?: string | null;
		detail?: string;
		size?: 'sm' | 'default' | 'lg';
		class?: string;
	}

	let {
		name,
		platform,
		platformLabel = '',
		avatarUrl = '',
		detail = '',
		size = 'default',
		class: className = ''
	}: Props = $props();

	const platformName = $derived(platformLabel || getPlatformName(platform));
</script>

<span class={cn('flex min-w-0 items-center gap-2.5 text-left', className)} data-size={size}>
	<SocialAccountAvatar {name} {platform} {avatarUrl} {size} />
	{#if size === 'sm'}
		<span class="flex min-w-0 items-baseline gap-1.5">
			<span class="truncate font-medium">{name}</span>
			<span data-slot="social-account-platform" class="shrink-0 text-xs text-muted-foreground"
				>· {platformName}</span
			>
		</span>
	{:else}
		<span class="min-w-0">
			<span class="block truncate text-sm font-medium">{name}</span>
			<span
				data-slot="social-account-platform"
				class="block truncate text-xs text-muted-foreground"
			>
				{platformName}{#if detail}
					· {detail}{/if}
			</span>
		</span>
	{/if}
</span>
