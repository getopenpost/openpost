<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import { ThemeIcon } from '$lib/themes/icons/index.js';
	import { buttonVariants, type ButtonVariant } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';
	import { m } from '$lib/paraglide/messages';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		variant = 'ghost',
		...restProps
	}: CalendarPrimitive.PrevButtonProps & {
		variant?: ButtonVariant;
	} = $props();
</script>

{#snippet Fallback()}
	<ThemeIcon role="chevron-left" class="size-4" />
{/snippet}

{#snippet PrimitiveChild({ props }: { props: HTMLButtonAttributes })}
	<button {...props} aria-label={m.calendar_previous()}>
		{#if children}
			{@render children()}
		{:else}
			{@render Fallback()}
		{/if}
	</button>
{/snippet}

<CalendarPrimitive.PrevButton
	bind:ref
	child={PrimitiveChild}
	data-cuelume-toggle="page"
	class={cn(
		buttonVariants({ variant }),
		'size-(--cell-size) bg-transparent p-0 select-none disabled:opacity-50 rtl:rotate-180',
		className
	)}
	{...restProps}
/>
