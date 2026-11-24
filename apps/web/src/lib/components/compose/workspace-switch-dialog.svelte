<script lang="ts">
	import type { ComposerWorkspaceSwitchState } from '$lib/composer/session';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';

	interface Props {
		/** The pending switch; the dialog is open while one exists. */
		state: ComposerWorkspaceSwitchState | null;
		editMode: boolean;
		onStay: () => void;
		onDiscard: () => void;
		onSave: () => void | Promise<void>;
	}

	// Asks whether to save, discard, or keep editing before the Workspace changes.
	let { state, editMode, onStay, onDiscard, onSave }: Props = $props();
</script>

<Dialog.Root
	open={state !== null}
	onOpenChange={(open) => {
		if (!open && state && !state.intent) onStay();
	}}
>
	<Dialog.Content class="sm:max-w-lg" data-testid="composer-workspace-switch-dialog">
		<Dialog.Header>
			<Dialog.Title>{m.compose_workspace_switch_title()}</Dialog.Title>
			<Dialog.Description>
				{m.compose_workspace_switch_body({
					workspace: state?.toWorkspaceName ?? ''
				})}
			</Dialog.Description>
		</Dialog.Header>
		{#if state?.error}
			<p class="text-sm text-destructive" role="alert">{state.error}</p>
		{/if}
		<Dialog.Footer class="gap-2 sm:justify-between">
			<Button type="button" variant="ghost" onclick={onStay} disabled={Boolean(state?.intent)}>
				{m.compose_workspace_switch_stay()}
			</Button>
			<div class="flex flex-col-reverse gap-2 sm:flex-row">
				<Button
					type="button"
					variant="destructive"
					onclick={onDiscard}
					disabled={Boolean(state?.intent)}
				>
					{m.compose_workspace_switch_discard()}
				</Button>
				<Button
					type="button"
					onclick={onSave}
					disabled={Boolean(state?.intent)}
					aria-busy={state?.intent === 'save'}
				>
					{#if state?.intent === 'save'}
						<ProtectedIcon icon="loading" class="size-4 animate-spin motion-reduce:animate-none" />
					{/if}
					{editMode ? m.compose_save_changes() : m.compose_save_draft()}
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
