<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { writeClipboardText } from '$lib/clipboard';
	import type { ButtonProps } from '$lib/components/ui/button';
	import AsyncActionButton, { type AsyncActionState } from './async-action-button.svelte';

	type Props = Omit<ButtonProps, 'children' | 'onclick' | 'href'> & {
		value: string;
		scopeKey: string;
		errorMessage: string;
		label?: string;
		successLabel?: string;
	};
	let {
		value,
		scopeKey,
		errorMessage,
		label = m.common_copy(),
		successLabel = m.common_copied(),
		...buttonProps
	}: Props = $props();
	let copyState = $state<AsyncActionState>('idle');
	let generation = 0;
	let resetTimer: ReturnType<typeof setTimeout> | undefined;
	const successLifetime = 2000;

	$effect(() => {
		void value;
		void scopeKey;
		generation++;
		copyState = 'idle';
		clearTimeout(resetTimer);
	});
	onDestroy(() => {
		generation++;
		clearTimeout(resetTimer);
	});

	async function copy() {
		if (copyState === 'pending') return;
		const copiedValue = value;
		const copiedScope = scopeKey;
		const request = ++generation;
		const isCurrent = () =>
			request === generation && value === copiedValue && scopeKey === copiedScope;
		clearTimeout(resetTimer);
		copyState = 'pending';
		try {
			await writeClipboardText(copiedValue);
			if (!isCurrent()) return;
			copyState = 'success';
			resetTimer = setTimeout(() => {
				if (isCurrent()) copyState = 'idle';
			}, successLifetime);
		} catch {
			if (isCurrent()) copyState = 'error';
		}
	}
</script>

<div class="flex min-w-0 flex-col items-start gap-1">
	{#key `${scopeKey}:${value}`}
		<AsyncActionButton
			{...buttonProps}
			state={copyState}
			{label}
			pendingLabel={label}
			{successLabel}
			errorLabel={m.common_retry()}
			icon="copy"
			onclick={copy}
			announce={copyState !== 'error'}
		/>
	{/key}
	{#if copyState === 'error'}
		<p class="max-w-64 text-xs text-destructive" role="alert">{errorMessage}</p>
	{/if}
</div>
