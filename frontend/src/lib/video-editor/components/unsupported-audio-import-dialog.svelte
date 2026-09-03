<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';

	let {
		open = $bindable(false),
		fileName,
		codec,
		ondecision
	}: {
		open?: boolean;
		fileName: string;
		codec: string;
		ondecision: (decision: 'import' | 'cancel') => void;
	} = $props();

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (!nextOpen) ondecision('cancel');
	}

	function decide(decision: 'import' | 'cancel'): void {
		ondecision(decision);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="video-editor-theme w-[calc(100%_-_1rem)] max-w-[480px] border-border bg-popover text-popover-foreground sm:max-w-[480px]"
	>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<ProtectedIcon icon="warning" class="size-4 text-warning-foreground" />
				{m.video_editor_unsupported_audio_title()}
			</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed text-[var(--video-editor-muted)]">
				{m.video_editor_unsupported_audio_description({ fileName, codec })}
			</Dialog.Description>
		</Dialog.Header>

		<div
			class="mt-4 rounded-md border border-warning/20 bg-warning/5 px-3 py-2.5 text-xs text-warning-foreground"
		>
			{m.video_editor_unsupported_audio_consequence()}
		</div>

		<Dialog.Footer class="mt-5">
			<Button
				type="button"
				variant="ghost"
				class="h-[44px] min-h-[44px]"
				onclick={() => decide('cancel')}
			>
				{m.common_cancel()}
			</Button>
			<Button
				type="button"
				variant="outline"
				class="h-[44px] min-h-[44px]"
				onclick={() => decide('import')}
			>
				{m.video_editor_unsupported_audio_import_anyway()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
