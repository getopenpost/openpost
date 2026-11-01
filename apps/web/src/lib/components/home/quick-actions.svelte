<script lang="ts">
	import { resolveAppPath } from '$lib/app-path';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';

	interface Props {
		canEdit?: boolean;
	}

	let { canEdit = false }: Props = $props();
</script>

{#if canEdit}
	<ul class="grid gap-3 sm:grid-cols-2" data-testid="home-quick-actions">
		<li>
			<button type="button" class="action" onclick={() => ideate.show()}>
				<ThemeIcon role="idea" class="size-5 shrink-0 text-muted-foreground" />
				<span class="text-sm font-semibold">{m.nav_ideas()}</span>
			</button>
		</li>
		<li>
			<a class="action" href={resolveAppPath('/studio')}>
				<ThemeIcon role="editors" class="size-5 shrink-0 text-muted-foreground" />
				<span class="text-sm font-semibold">{m.nav_studio()}</span>
			</a>
		</li>
	</ul>
{/if}

<style>
	.action {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 3.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		text-align: start;
		transition: background-color 160ms ease-out;
	}

	.action:hover {
		background: var(--card-hover);
	}

	.action:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
