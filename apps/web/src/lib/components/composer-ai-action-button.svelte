<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import ActionLabel, { type ActionFace } from './action-label.svelte';

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

	let {
		hasText,
		building,
		disabled,
		ideateLabel,
		buildLabel,
		buildingLabel,
		title,
		onclick
	}: Props = $props();

	const active = $derived(building ? 'building' : hasText ? 'build' : 'ideate');
	const activeLabel = $derived(building ? buildingLabel : hasText ? buildLabel : ideateLabel);
	const faces: ActionFace[] = $derived([
		{ id: 'ideate', label: ideateLabel, icon: 'idea' },
		{ id: 'build', label: buildLabel, icon: 'sparkles' },
		{ id: 'building', label: buildingLabel, status: 'loading' }
	]);
</script>

<Button
	type="button"
	variant={hasText ? 'secondary' : 'default'}
	size="sm"
	class="ml-auto min-h-11 md:min-h-8"
	{disabled}
	onclick={() => {
		if (!building) void onclick();
	}}
	aria-label={activeLabel}
	aria-busy={building}
	aria-disabled={building || disabled || undefined}
	{title}
	data-state={active}
>
	<ActionLabel {faces} {active} />
</Button>
