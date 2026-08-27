<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import LinkIcon from '@lucide/svelte/icons/link';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';

	let {
		open = $bindable(false),
		onimport
	}: { open?: boolean; onimport: (url: string) => Promise<void> } = $props();

	let url = $state('');
	let working = $state(false);
	let error = $state('');

	function close(): void {
		if (working) return;
		open = false;
		url = '';
		error = '';
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (working || !url.trim()) return;
		working = true;
		error = '';
		try {
			await onimport(url.trim());
			open = false;
			url = '';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : String(reason);
		} finally {
			working = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme w-[calc(100%_-_1rem)] max-w-[480px] border-[oklch(0.31_0.018_55)] bg-[oklch(0.16_0.012_50)] text-[var(--video-editor-text)] sm:max-w-[480px]"
		showCloseButton={!working}
	>
		<form onsubmit={submit}>
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-base">
					<LinkIcon class="size-4 text-[var(--video-editor-focus)]" aria-hidden="true" />
					{m.video_editor_media_import_url()}
				</Dialog.Title>
				<Dialog.Description class="text-xs text-[var(--video-editor-muted)]">
					{m.video_editor_media_import_url_description()}
				</Dialog.Description>
			</Dialog.Header>

			<div class="mt-4 space-y-2">
				<label for="remote-media-url" class="text-xs font-medium">
					{m.video_editor_media_import_url_label()}
				</label>
				<Input
					id="remote-media-url"
					type="url"
					bind:value={url}
					placeholder={m.video_editor_media_import_url_placeholder()}
					autocomplete="off"
					spellcheck="false"
					disabled={working}
					aria-invalid={error ? 'true' : undefined}
				/>
				{#if error}
					<p
						class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
						role="alert"
					>
						{error}
					</p>
				{/if}
			</div>

			<Dialog.Footer class="mt-5">
				<Button type="button" variant="ghost" disabled={working} onclick={close}>
					{m.common_cancel()}
				</Button>
				<Button type="submit" disabled={working || !url.trim()}>
					{#if working}<LoaderIcon
							class="size-3.5 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>{/if}
					{working
						? m.video_editor_media_import_url_working()
						: m.video_editor_media_import_url_action()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
