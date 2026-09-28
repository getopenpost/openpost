<script lang="ts">
	import { importCurl } from './curl';
	import type { Value } from './api';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';
	let { onimport }: { onimport: (inputs: Record<string, Value>) => void } = $props();
	let open = $state(false),
		command = $state(''),
		error = $state('');
</script>

<div>
	<Button variant="outline" size="sm" onclick={() => (open = !open)}
		>{m.workflows_import_curl()}</Button
	>
	{#if open}<div class="mt-3 space-y-3">
			<p class="text-xs leading-5 text-muted-foreground">{m.workflows_curl_help()}</p>
			<Label for="workflow-curl">{m.workflows_curl_command()}</Label><Textarea
				id="workflow-curl"
				rows={4}
				bind:value={command}
				placeholder="curl https://api.example.com/updates"
			/>{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}<Button
				size="sm"
				onclick={() => {
					try {
						onimport(importCurl(command));
						command = '';
						error = '';
						open = false;
					} catch (cause) {
						error = cause instanceof Error ? cause.message : m.workflows_curl_invalid();
					}
				}}>{m.workflows_curl_import()}</Button
			>
		</div>{/if}
</div>
