<script lang="ts">
	import type { IconComponent } from '$lib/component-types';
	import { Button } from '$lib/components/ui/button';
	import type { ThemeIconRole } from '$lib/themes';
	import { ThemeIcon } from '$lib/themes/icons';

	type IconProps =
		| {
				/** Custom or protected icon component to display */
				icon: IconComponent;
				themeIconRole?: never;
		  }
		| {
				icon?: never;
				/** Semantic icon role resolved from the active organization theme */
				themeIconRole: ThemeIconRole;
		  };

	type Props = IconProps & {
		/** Main title text */
		title: string;
		/** Description text */
		description?: string;
		/** Primary action button text */
		actionLabel?: string;
		/** Primary action button callback */
		onAction?: () => void;
		/** Optional href for the action button (instead of onAction) */
		actionHref?: string;
		/** Variant for the container style */
		variant?: 'default' | 'dashed' | 'muted';
		/** Additional padding size */
		size?: 'sm' | 'md' | 'lg';
		/** Heading level within the surrounding page hierarchy */
		headingLevel?: 2 | 3 | 4;
	};

	let {
		icon: Icon,
		themeIconRole,
		title,
		description,
		actionLabel,
		onAction,
		actionHref,
		variant = 'default',
		size = 'md',
		headingLevel = 2
	}: Props = $props();

	const variantClasses = {
		default: 'border bg-card',
		dashed: 'border border-dashed',
		muted: 'border border-dashed bg-muted/30'
	};

	const sizeClasses = {
		sm: 'py-6',
		md: 'py-8',
		lg: 'py-10'
	};
</script>

<div
	data-slot="empty-state"
	class="empty-state flex flex-col items-start gap-4 rounded-lg px-4 text-left {variantClasses[
		variant
	]} {sizeClasses[size]}"
>
	<div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
		{#if themeIconRole}
			<ThemeIcon role={themeIconRole} class="size-5 text-muted-foreground" />
		{:else if Icon}
			<Icon class="size-5 text-muted-foreground" />
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		{#if headingLevel === 3}
			<h3 class="text-sm font-semibold">{title}</h3>
		{:else if headingLevel === 4}
			<h4 class="text-sm font-semibold">{title}</h4>
		{:else}
			<h2 class="text-sm font-semibold">{title}</h2>
		{/if}
		{#if description}
			<p class="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
				{description}
			</p>
		{/if}
	</div>
	{#if actionLabel}
		<div class="empty-state-action w-full shrink-0">
			{#if actionHref}
				<Button href={actionHref} size="sm" variant="outline" class="w-full">{actionLabel}</Button>
			{:else if onAction}
				<Button onclick={onAction} size="sm" variant="outline" class="w-full">{actionLabel}</Button>
			{/if}
		</div>
	{/if}
</div>

<style>
	@container (min-width: 36rem) {
		.empty-state {
			flex-direction: row;
			align-items: center;
		}

		.empty-state-action,
		.empty-state-action :global([data-slot='button']) {
			width: auto;
		}
	}
</style>
