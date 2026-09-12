<script lang="ts" module>
	export type AsyncActionState = 'idle' | 'pending' | 'success' | 'error';
</script>

<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button';
	import type { ThemeIconRole } from '$lib/themes/contracts';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import ActionLabel, { type ActionFace } from './action-label.svelte';

	type Props = Pick<HTMLButtonAttributes, 'class' | 'type' | 'title' | 'disabled' | 'onclick'> &
		Pick<ButtonProps, 'variant' | 'intent' | 'size'> & {
			'data-testid'?: string;
			state?: AsyncActionState;
			label: string;
			pendingLabel?: string;
			successLabel?: string;
			errorLabel?: string;
			icon?: ThemeIconRole;
			announce?: boolean;
		};
	let {
		state: actionState = 'idle',
		label,
		pendingLabel = label,
		successLabel = label,
		errorLabel = label,
		icon,
		announce = true,
		onclick,
		disabled,
		...buttonProps
	}: Props = $props();
	let running = $state(false);
	const displayedState = $derived(running ? 'pending' : actionState);
	const faces: ActionFace[] = $derived([
		{ id: 'idle', label, icon },
		{ id: 'pending', label: pendingLabel, status: 'loading' },
		{ id: 'success', label: successLabel, status: 'success' },
		{ id: 'error', label: errorLabel, status: 'error' }
	]);
	const activeLabel = $derived(faces.find((face) => face.id === displayedState)!.label);

	type ActionEvent = MouseEvent & {
		currentTarget: EventTarget & (HTMLButtonElement | HTMLAnchorElement);
	};
	function isButtonEvent(
		event: ActionEvent
	): event is MouseEvent & { currentTarget: EventTarget & HTMLButtonElement } {
		return event.currentTarget instanceof HTMLButtonElement;
	}

	async function activate(event: ActionEvent) {
		if (!isButtonEvent(event)) return;
		if (disabled || running || actionState === 'pending') return;
		running = true;
		try {
			await onclick?.(event);
		} finally {
			running = false;
		}
	}
</script>

<Button
	{...buttonProps}
	{disabled}
	onclick={activate}
	aria-label={activeLabel}
	aria-busy={displayedState === 'pending'}
	aria-disabled={displayedState === 'pending' || disabled || undefined}
	data-state={displayedState}
>
	<ActionLabel {faces} active={displayedState} />
</Button>
{#if announce}
	<span role="status" aria-live="polite" aria-atomic="true" class="sr-only">
		{displayedState === 'success' || displayedState === 'error' ? activeLabel : ''}
	</span>
{/if}
