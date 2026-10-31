<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ThemeIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';

	interface Props {
		/**
		 * Accessible name for the search field. Also the default placeholder,
		 * so callers pass one message key for both unless they differ.
		 */
		label: string;
		/** Live-bound query text. */
		value?: string;
		placeholder?: string;
		/**
		 * Submit semantics for applied-search lists. When set, the field renders
		 * inside a form with a submit button and Enter submits (IME-safe). Leave
		 * undefined for live filtering through `bind:value` alone.
		 */
		onsubmit?: () => void;
		/** Accessible name of the submit button; defaults to `label`. */
		submitLabel?: string;
		/**
		 * Clearing has effects beyond the field, such as re-running an applied
		 * search. When set, an explicit clear button replaces the native search
		 * cancel affordance so the effect is discoverable.
		 */
		onclear?: () => void;
		/** Accessible name of the clear button; defaults to `label`. */
		clearLabel?: string;
		/**
		 * Overrides explicit clear-button visibility. Defaults to a non-empty
		 * field; applied-search callers keep it visible while a submitted query
		 * still filters, even after the field itself is emptied.
		 */
		clearVisible?: boolean;
		class?: string;
	}

	let {
		label,
		value = $bindable(''),
		placeholder = label,
		onsubmit,
		submitLabel = label,
		onclear,
		clearLabel = label,
		clearVisible,
		class: className
	}: Props = $props();

	const clearShown = $derived(clearVisible ?? value !== '');
	const fieldClass = $derived(cn('pl-9', onclear && 'pr-10'));

	function submit() {
		onsubmit?.();
	}
</script>

{#snippet field()}
	<ThemeIcon
		role="search"
		class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
	/>
	<Input
		type="search"
		bind:value
		{placeholder}
		aria-label={label}
		class={fieldClass}
		onkeydown={(event) => {
			if (!onsubmit) return;
			if (event.key === 'Enter' && !event.isComposing) {
				event.preventDefault();
				submit();
			}
		}}
	/>
	{#if onclear && clearShown}
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			class="absolute top-1/2 right-0.5 -translate-y-1/2"
			aria-label={clearLabel}
			onclick={() => onclear?.()}
		>
			<ThemeIcon role="close" class="size-4" />
		</Button>
	{/if}
{/snippet}

{#if onsubmit}
	<form
		class={cn('flex min-w-0 flex-1 gap-2', className)}
		onsubmit={(event) => {
			event.preventDefault();
			submit();
		}}
	>
		<div class={cn('relative min-w-0 flex-1', onclear && 'list-search-field')}>
			{@render field()}
		</div>
		<Button type="submit" variant="outline" size="icon" aria-label={submitLabel}>
			<ThemeIcon role="search" />
		</Button>
	</form>
{:else}
	<div class={cn('relative min-w-0', onclear && 'list-search-field', className)}>
		{@render field()}
	</div>
{/if}

<style>
	/* The explicit clear button replaces the native cancel affordance. */
	.list-search-field :global(input::-webkit-search-cancel-button) {
		display: none;
	}
</style>
