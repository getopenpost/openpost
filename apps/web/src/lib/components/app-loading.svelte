<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';

	interface Props {
		label?: string;
		minHeight?: string;
	}

	let { label = 'Loading OpenPost', minHeight = '100dvh' }: Props = $props();
</script>

<div
	data-slot="app-loading"
	data-testid="app-loading"
	class="flex flex-1 flex-col items-center justify-center gap-4 px-4"
	style:min-height={minHeight}
	role="status"
	aria-live="polite"
	aria-busy="true"
>
	<Logo width={52} height={40} decorative />
	<div class="h-1 w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
		<div class="loading-progress h-full w-1/2 rounded-full bg-primary"></div>
	</div>
	<span class="sr-only">{label}</span>
</div>

<style>
	.loading-progress {
		animation: loading-progress 1.4s cubic-bezier(0.25, 1, 0.5, 1) infinite;
		transform: translateX(-110%);
	}

	@keyframes loading-progress {
		to {
			transform: translateX(220%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.loading-progress {
			animation: none;
			transform: translateX(50%);
		}
	}
</style>
