<script lang="ts" module>
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { type VariantProps, tv } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-2 aria-invalid:ring-2 [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[transform,box-shadow,background-color,border-color,color] duration-[140ms] ease-out active:duration-200 outline-none select-none disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default:
					'border-primary bg-primary text-primary-foreground font-semibold shadow-[0_3px_0_color-mix(in_oklch,var(--primary)_68%,black)] hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[0_5px_0_color-mix(in_oklch,var(--primary)_68%,black)] active:translate-y-0.5 active:shadow-[0_1px_0_color-mix(in_oklch,var(--primary)_68%,black)]',
				outline:
					'border-primary/75 bg-background text-foreground shadow-[0_3px_0_color-mix(in_oklch,var(--primary)_68%,black)] hover:-translate-y-0.5 hover:border-primary hover:bg-primary/6 hover:shadow-[0_5px_0_color-mix(in_oklch,var(--primary)_68%,black)] active:translate-y-0.5 active:shadow-[0_1px_0_color-mix(in_oklch,var(--primary)_68%,black)] aria-expanded:translate-y-0.5 aria-expanded:bg-primary/8 aria-expanded:shadow-[0_1px_0_color-mix(in_oklch,var(--primary)_68%,black)]',
				secondary:
					'border-border bg-secondary text-secondary-foreground shadow-[0_3px_0_color-mix(in_oklch,var(--border)_72%,var(--foreground))] hover:-translate-y-0.5 hover:bg-secondary/80 hover:shadow-[0_5px_0_color-mix(in_oklch,var(--border)_72%,var(--foreground))] active:translate-y-0.5 active:shadow-[0_1px_0_color-mix(in_oklch,var(--border)_72%,var(--foreground))] aria-expanded:translate-y-0.5 aria-expanded:bg-secondary aria-expanded:shadow-[0_1px_0_color-mix(in_oklch,var(--border)_72%,var(--foreground))]',
				ghost:
					'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground',
				destructive:
					'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30',
				link: 'text-primary underline-offset-4 hover:underline'
			},
			size: {
				default:
					"h-11 gap-1.5 px-3 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 md:h-9 [&_svg:not([class*='size-'])]:size-4",
				xs: "h-11 gap-1 rounded-sm px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 md:h-7 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-11 gap-1 px-2.5 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 md:h-8 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-11 gap-1.5 px-4 text-sm has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 md:h-10 [&_svg:not([class*='size-'])]:size-4",
				icon: "size-11 md:size-9 [&_svg:not([class*='size-'])]:size-4",
				'icon-xs': "size-11 rounded-sm md:size-7 [&_svg:not([class*='size-'])]:size-3",
				'icon-sm': "size-11 md:size-8 [&_svg:not([class*='size-'])]:size-3.5",
				'icon-lg': "size-11 md:size-10 [&_svg:not([class*='size-'])]:size-4"
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

	const hasTactileFeedback = $derived(
		variant === 'default' || variant === 'outline' || variant === 'secondary'
	);
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		data-cuelume-press={hasTactileFeedback ? 'press' : undefined}
		data-cuelume-release={hasTactileFeedback ? 'release' : undefined}
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
		data-cuelume-press={hasTactileFeedback ? 'press' : undefined}
		data-cuelume-release={hasTactileFeedback ? 'release' : undefined}
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
