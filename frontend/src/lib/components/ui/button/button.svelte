<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 relative rounded-md border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-2 aria-invalid:ring-2 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[transform,box-shadow,background-color,border-color,color] duration-[140ms] ease-out active:duration-100 outline-none select-none disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 after:absolute after:inset-x-0 after:-bottom-1.5 after:content-['']",
		variants: {
			variant: {
				default:
					'border-primary bg-primary text-primary-foreground font-semibold hover:bg-primary/90 active:translate-y-px',
				focal:
					'border-primary bg-primary text-primary-foreground font-semibold shadow-[0_4px_12px_-6px_color-mix(in_oklch,var(--primary)_80%,black)] hover:bg-primary/90 hover:shadow-[0_5px_14px_-7px_color-mix(in_oklch,var(--primary)_76%,black)] active:translate-y-px active:shadow-sm',
				outline:
					'border-border bg-background text-foreground hover:border-primary/50 hover:bg-primary/6 active:translate-y-px aria-expanded:border-primary/50 aria-expanded:bg-primary/8',
				secondary:
					'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 active:translate-y-px aria-expanded:bg-secondary',
				ghost:
					'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground',
				destructive:
					'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30',
				link: 'text-primary underline-offset-4 hover:underline'
			},
			size: {
				default:
					"h-11 gap-1.5 px-3 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 md:h-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-4",
				xs: "h-11 gap-1 rounded-sm px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 md:h-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-11 gap-1 px-2.5 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 md:h-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11 [&_svg:not([class*='size-'])]:size-3.5",
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
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();

	const hasActionFeedback = $derived(
		variant === 'default' ||
			variant === 'focal' ||
			variant === 'outline' ||
			variant === 'secondary' ||
			variant === 'destructive'
	);
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		data-cuelume-toggle={hasActionFeedback ? 'release' : undefined}
		class={cn(buttonVariants({ variant, size }), className)}
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
		data-cuelume-toggle={hasActionFeedback ? 'release' : undefined}
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
