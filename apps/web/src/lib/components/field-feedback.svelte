<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		id: string;
		error?: string;
		touched?: boolean;
		class?: string;
	}

	let { id, error = '', touched = false, class: className }: Props = $props();
	const visible = $derived(Boolean(touched && error));
</script>

<div
	{id}
	role="status"
	aria-live="polite"
	aria-atomic="true"
	data-visible={visible}
	class={cn('field-feedback-shell text-xs text-destructive', className)}
>
	<div class="field-feedback-content">
		{#if visible}<span>{error}</span>{/if}
	</div>
</div>

<style>
	.field-feedback-shell {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows 180ms cubic-bezier(0.16, 1, 0.3, 1),
			opacity 120ms ease-out;
	}

	.field-feedback-shell[data-visible='true'] {
		grid-template-rows: 1fr;
		opacity: 1;
	}

	.field-feedback-content {
		min-height: 0;
		overflow: hidden;
	}

	@media (prefers-reduced-motion: reduce) {
		.field-feedback-shell {
			transition: none;
		}
	}
</style>
