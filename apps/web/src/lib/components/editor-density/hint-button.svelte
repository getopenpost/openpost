<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';

	// Tap-friendly help affordance for workstation panels. Hint text must be
	// reachable by touch and pen users, so it lives in a popover instead of a
	// hover-only title attribute.
	let {
		label,
		hint,
		class: className = ''
	}: {
		label: string;
		hint: string;
		class?: string;
	} = $props();
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="icon-xs"
				class={cn(
					'size-[22px] text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:size-11',
					className
				)}
				aria-label={label}
			>
				<ThemeIcon role="help" class="size-3" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content side="top" align="start" class="max-w-64 p-2 text-xs text-muted-foreground">
		{hint}
	</Popover.Content>
</Popover.Root>
