<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	interface Props {
		hasText: boolean;
		building: boolean;
		disabled: boolean;
		ideateLabel: string;
		buildLabel: string;
		buildingLabel: string;
		title?: string;
		onclick: () => void | Promise<void>;
	}

	let { building, disabled, ideateLabel, buildingLabel, title, onclick }: Props = $props();

	const activeLabel = $derived(building ? buildingLabel : ideateLabel);
</script>

<Button
	type="button"
	variant="secondary"
	size="sm"
	class="ms-auto min-h-11 md:min-h-8"
	disabled={disabled || building}
	{title}
	onclick={() => void onclick()}
	aria-label={activeLabel}
	aria-busy={building}
>
	{#if building}<ProtectedIcon
			icon="loading"
			class="size-3.5 animate-spin motion-reduce:animate-none"
		/>{:else}<ThemeIcon role="sparkles" class="size-3.5" />{/if}
	{activeLabel}
</Button>
