<script lang="ts">
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import * as Avatar from '$lib/components/ui/avatar';
	import { cn, getPlatformColor } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props {
		name: string;
		platform: string;
		avatarUrl?: string | null;
		size?: 'sm' | 'default' | 'lg';
		class?: string;
	}

	let {
		name,
		platform,
		avatarUrl = '',
		size = 'default',
		class: className = '',
		...restProps
	}: Props & HTMLAttributes<HTMLSpanElement> = $props();

	const fallback = $derived.by(() => {
		const normalized = name.trim().replace(/^@+/, '');
		if (!normalized) return '?';
		const words = normalized.split(/\s+/).filter(Boolean);
		if (words.length > 1) {
			return `${words[0][0]}${words.at(-1)?.[0] ?? ''}`.toUpperCase();
		}
		return normalized.slice(0, 2).toUpperCase();
	});
</script>

<Avatar.Root {size} class={cn('overflow-visible', className)} {...restProps}>
	{#snippet child({ props })}
		<span {...props} aria-hidden="true">
			{#if avatarUrl}
				<Avatar.Image src={avatarUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
			{/if}
			<Avatar.Fallback>{fallback}</Avatar.Fallback>
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
		</span>
	{/snippet}
</Avatar.Root>
