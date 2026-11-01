<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import { ui } from '$lib/stores/ui.svelte';

	interface Props {
		canEdit?: boolean;
	}

	let { canEdit = false }: Props = $props();

	function startNewPost() {
		if (!ui.startNewPost()) return;
		void goto(resolveAppPath('/'));
	}
</script>

{#if canEdit}
	<div class="flex flex-wrap gap-2" data-testid="home-quick-actions">
		<Button variant="outline" class="min-h-11 sm:min-h-9" onclick={startNewPost}>
			<ThemeIcon role="compose" class="size-4" />
			{m.sidebar_new_post()}
		</Button>
		<Button variant="outline" class="min-h-11 sm:min-h-9" onclick={() => ideate.show()}>
			<ThemeIcon role="idea" class="size-4" />
			{m.nav_ideas()}
		</Button>
		<Button variant="outline" class="min-h-11 sm:min-h-9" href={resolveAppPath('/studio')}>
			<ThemeIcon role="editors" class="size-4" />
			{m.nav_studio()}
		</Button>
	</div>
{/if}
