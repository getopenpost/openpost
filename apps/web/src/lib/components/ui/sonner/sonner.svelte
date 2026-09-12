<script lang="ts">
	import { Toaster as Sonner, type ToasterProps as SonnerProps } from 'svelte-sonner';
	import { mode } from 'mode-watcher';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons/index.js';

	let { ...restProps }: SonnerProps = $props();
</script>

<Sonner
	data-slot="toaster"
	theme={mode.current}
	class="toaster group"
	mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 4rem)' }}
	style="--normal-bg: var(--popover); --normal-text: var(--popover-foreground); --normal-border: var(--border);"
	{...restProps}
>
	{#snippet loadingIcon()}<ProtectedIcon icon="loading" class="size-4 animate-spin" />{/snippet}
	{#snippet successIcon()}<ProtectedIcon icon="success" class="size-4" />{/snippet}
	{#snippet errorIcon()}<ProtectedIcon icon="error" class="size-4" />{/snippet}
	{#snippet infoIcon()}<ProtectedIcon icon="info" class="size-4" />{/snippet}
	{#snippet warningIcon()}<ProtectedIcon icon="warning" class="size-4" />{/snippet}
</Sonner>

<style>
	:global([data-sonner-toaster][data-sonner-theme='light']),
	:global([data-sonner-toaster][data-sonner-theme='dark']) {
		--success-text: var(--success-foreground);
		--error-bg:
			linear-gradient(var(--action-destructive), var(--action-destructive)), var(--popover);
		--error-text: var(--action-destructive-foreground);
		--error-border: color-mix(in oklch, var(--destructive) 40%, var(--border));
	}

	@media (max-width: 600px) {
		:global([data-sonner-toaster][data-x-position]) {
			left: var(--mobile-offset-left);
			right: var(--mobile-offset-right);
			width: auto;
			transform: none !important;
			transition: none;
		}

		:global([data-sonner-toaster]) :global([data-sonner-toast]) {
			width: 100%;
		}
	}
</style>
