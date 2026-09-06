<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils';

	interface Props {
		value: string;
		ariaLabel: string;
		disabled?: boolean;
		class?: string;
		onchange: (value: string) => void;
		onkeydown?: (event: KeyboardEvent) => void;
	}

	let {
		value,
		ariaLabel,
		disabled = false,
		class: className,
		onchange,
		onkeydown
	}: Props = $props();
</script>

<Input
	{value}
	class={cn(
		'h-11 min-w-0 border-transparent bg-transparent px-2 font-medium hover:border-input focus:border-input md:h-11 lg:h-8',
		className
	)}
	aria-label={ariaLabel}
	{disabled}
	oninput={(event) => onchange(event.currentTarget.value)}
	{onkeydown}
/>
