<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		publicationID: string;
		onCreateAnother: () => void;
	}

	let { publicationID, onCreateAnother }: Props = $props();
</script>

<section
	data-testid="workspace-activation-completion"
	class="mx-auto mt-4 flex w-[calc(100%-1.5rem)] max-w-2xl flex-col gap-3 rounded-lg border border-success-foreground/25 bg-success p-4 sm:w-[calc(100%-3rem)] sm:flex-row sm:items-center sm:justify-between"
	aria-labelledby="workspace-activation-heading"
>
	<div class="min-w-0">
		<h2 id="workspace-activation-heading" class="font-semibold">
			{m.workspace_activation_heading()}
		</h2>
		<p class="mt-1 text-sm/6 text-muted-foreground">{m.workspace_activation_description()}</p>
	</div>
	<div class="flex shrink-0 flex-col gap-2 min-[360px]:flex-row">
		<Button href={`/publications/${encodeURIComponent(publicationID)}`} variant="outline">
			{m.workspace_activation_view_publication()}
		</Button>
		<Button onclick={onCreateAnother}>{m.workspace_activation_create_another()}</Button>
	</div>
</section>
