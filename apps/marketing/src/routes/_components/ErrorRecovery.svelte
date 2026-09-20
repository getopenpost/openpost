<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { marketingErrorRecovery } from '../_error-recovery';

	interface Props {
		status?: number;
		label?: string;
		title?: string;
		description?: string;
	}

	let {
		status = marketingErrorRecovery.status,
		label = marketingErrorRecovery.label,
		title = marketingErrorRecovery.title,
		description = marketingErrorRecovery.description
	}: Props = $props();

	function linkAttributes(href: string) {
		// SAFETY: Recovery links are maintained route literals or absolute external URLs.
		return href.startsWith('/') ? { href: resolve(href as '/') } : { href };
	}

	function externalAttributes(href: string) {
		return href.startsWith('https://')
			? { target: '_blank' as const, rel: 'noreferrer' as const }
			: {};
	}

	const primary = marketingErrorRecovery.primary;
</script>

<section class="error-recovery marketing-shell" aria-labelledby="error-recovery-title">
	<p class="error-code">{status} · {label}</p>
	<h1 id="error-recovery-title" class="marketing-title">{title}</h1>
	<p class="marketing-copy">{description}</p>
	<div class="error-actions">
		<Button href={linkAttributes(primary.href).href} size="lg">
			<ArrowLeft data-icon="inline-start" />
			{primary.label}
		</Button>
	</div>
	<nav class="error-links" aria-label="Continue from a maintained page">
		{#each marketingErrorRecovery.routes as route (route.href)}
			<a class="focus-ring" {...linkAttributes(route.href)} {...externalAttributes(route.href)}
				>{route.label}</a
			>
		{/each}
		<span class="error-support" aria-label="Support paths">
			{#each marketingErrorRecovery.support as link (link.href)}
				<a class="focus-ring" {...linkAttributes(link.href)} {...externalAttributes(link.href)}
					>{link.label}</a
				>
			{/each}
		</span>
	</nav>
</section>

<style>
	.error-recovery {
		padding-block: clamp(4rem, 8vw, 7rem);
	}

	.error-code {
		color: var(--primary);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.error-recovery h1 {
		max-width: 16ch;
		margin-top: 1rem;
	}

	.error-recovery .marketing-copy {
		margin-top: 1.25rem;
		max-width: 52ch;
	}

	.error-actions {
		margin-top: 2rem;
	}

	.error-actions :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.error-links {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 1.25rem;
		margin-top: 2.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border);
	}

	.error-links a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		border-radius: 0.5rem;
		color: var(--foreground);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.error-support {
		display: contents;
	}
</style>
