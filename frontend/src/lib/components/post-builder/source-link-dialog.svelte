<script lang="ts">
	import LinkIcon from '@lucide/svelte/icons/link-2';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		disabled?: boolean;
		onAdd: (url: string) => void;
	}

	let { open = $bindable(false), disabled = false, onAdd }: Props = $props();
	let value = $state('');
	let error = $state('');

	function add(): void {
		let url: URL;
		try {
			url = new URL(value.trim());
		} catch {
			error = m.post_builder_link_invalid();
			return;
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			error = m.post_builder_link_invalid();
			return;
		}
		onAdd(url.toString());
		value = '';
		error = '';
		open = false;
	}

	function handleOpenChange(next: boolean): void {
		if (next) error = '';
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<LinkIcon class="size-4 text-primary" />
				{m.post_builder_link_title()}
			</Dialog.Title>
			<Dialog.Description>{m.post_builder_link_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-2">
			<Label for="post-builder-source-url">{m.post_builder_link_label()}</Label>
			<Input
				id="post-builder-source-url"
				type="url"
				bind:value
				placeholder="https://"
				maxlength={8192}
				{disabled}
				onkeydown={(event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					add();
				}}
			/>
		</div>

		{#if error}<InlineNotice tone="error" message={error} />{/if}

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>
				{m.common_cancel()}
			</Button>
			<Button type="button" disabled={disabled || !value.trim()} onclick={add}>
				{m.post_builder_link_add()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
