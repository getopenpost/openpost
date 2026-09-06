<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { ThemeActionIntent } from '$lib/themes/contracts.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 relative rounded-md border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-2 aria-invalid:ring-2 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[transform,box-shadow,background-color,border-color,color] [transition-duration:var(--theme-duration-normal)] [transition-timing-function:var(--theme-easing)] active:[transition-duration:var(--theme-duration-fast)] outline-none select-none disabled:pointer-events-none disabled:translate-y-0 disabled:border-transparent disabled:bg-disabled disabled:text-disabled-foreground disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 after:absolute after:inset-x-0 after:-bottom-1.5 after:content-['']",
		variants: {
			variant: {
				default:
					'border-action-primary bg-action-primary text-action-primary-foreground font-semibold hover:bg-action-primary-hover active:bg-action-primary-active active:[transform:translateY(var(--theme-press-distance))]',
				primary:
					'border-action-primary bg-action-primary text-action-primary-foreground font-semibold hover:bg-action-primary-hover active:bg-action-primary-active active:[transform:translateY(var(--theme-press-distance))]',
				focal:
					'border-action-focal bg-action-focal text-action-focal-foreground font-semibold [box-shadow:var(--theme-shadow-focal-action)] hover:bg-action-focal-hover active:bg-action-focal-active active:[transform:translateY(var(--theme-press-distance))]',
				outline:
					'border-action-ordinary-border bg-action-ordinary text-action-ordinary-foreground hover:bg-action-ordinary-hover active:bg-action-ordinary-active active:[transform:translateY(var(--theme-press-distance))] aria-expanded:bg-action-ordinary-hover',
				secondary:
					'border-action-ordinary-border bg-action-ordinary text-action-ordinary-foreground hover:bg-action-ordinary-hover active:bg-action-ordinary-active active:[transform:translateY(var(--theme-press-distance))] aria-expanded:bg-action-ordinary-hover',
				ordinary:
					'border-action-ordinary-border bg-action-ordinary text-action-ordinary-foreground hover:bg-action-ordinary-hover active:bg-action-ordinary-active active:[transform:translateY(var(--theme-press-distance))] aria-expanded:bg-action-ordinary-hover',
				ghost:
					'bg-action-quiet text-action-quiet-foreground hover:bg-action-quiet-hover active:bg-action-quiet-active aria-expanded:bg-action-quiet-hover',
				quiet:
					'bg-action-quiet text-action-quiet-foreground hover:bg-action-quiet-hover active:bg-action-quiet-active aria-expanded:bg-action-quiet-hover',
				destructive:
					'border-transparent bg-action-destructive text-action-destructive-foreground hover:bg-action-destructive-hover active:bg-action-destructive-active focus-visible:border-destructive focus-visible:ring-destructive/25',
				link: 'text-action-link underline-offset-4 hover:text-action-link-hover hover:underline'
			},
			size: {
				default:
					"h-11 gap-1.5 px-3 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 md:h-[var(--theme-control-height)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-4",
				xs: "h-11 gap-1 rounded-sm px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 md:h-[var(--theme-compact-control-height)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-11 gap-1 px-2.5 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 md:h-[var(--theme-compact-control-height)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-11 gap-1.5 px-4 text-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 md:h-10 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-4",
				icon: "size-11 md:size-9 [@media(pointer:coarse)]:size-11 [&_svg:not([class*='size-'])]:size-4",
				'icon-xs':
					"size-11 rounded-sm md:size-7 [@media(pointer:coarse)]:size-11 [&_svg:not([class*='size-'])]:size-3",
				'icon-sm':
					"size-11 md:size-8 [@media(pointer:coarse)]:size-11 [&_svg:not([class*='size-'])]:size-3.5",
				'icon-lg':
					"size-11 md:size-10 [@media(pointer:coarse)]:size-11 [&_svg:not([class*='size-'])]:size-4"
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			intent?: ThemeActionIntent;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		intent,
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
	const legacyIntent = {
		default: 'primary',
		primary: 'primary',
		focal: 'focal',
		outline: 'ordinary',
		secondary: 'ordinary',
		ordinary: 'ordinary',
		ghost: 'quiet',
		quiet: 'quiet',
		destructive: 'destructive',
		link: 'link'
	} satisfies Record<NonNullable<ButtonVariant>, ThemeActionIntent>;
	const resolvedIntent = $derived(intent ?? legacyIntent[variant ?? 'default']);
	const resolvedVariant = $derived(intent ?? variant);

	const hasActionFeedback = $derived(
		resolvedIntent === 'focal' ||
			resolvedIntent === 'primary' ||
			resolvedIntent === 'ordinary' ||
			resolvedIntent === 'destructive'
	);
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		data-action-intent={resolvedIntent}
		data-cuelume-toggle={hasActionFeedback ? 'release' : undefined}
		class={cn(buttonVariants({ variant: resolvedVariant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		data-action-intent={resolvedIntent}
		data-cuelume-toggle={hasActionFeedback ? 'release' : undefined}
		class={cn(buttonVariants({ variant: resolvedVariant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
