<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { client } from '$lib/api/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
	}

	let { open = $bindable(false) }: Props = $props();
	let workspaceName = $state('');
	let error = $state('');
	let pending = $state(false);
	const canCreate = $derived(Boolean(workspaceName.trim()) && !pending);

	function reset() {
		workspaceName = '';
		error = '';
	}

	function handleOpenChange(isOpen: boolean) {
		if (!isOpen && pending) return;
		open = isOpen;
		if (!isOpen) reset();
	}

	function close() {
		handleOpenChange(false);
	}

	async function createWorkspace(event: SubmitEvent) {
		event.preventDefault();
		const name = workspaceName.trim();
		if (!name || pending) return;

		pending = true;
		error = '';
		try {
			const organizationID = workspaceCtx.currentWorkspace?.organization_id?.trim() ?? '';
			const { data, error: responseError } = await client.POST('/workspaces', {
				body: { name, ...(organizationID ? { organization_id: organizationID } : {}) }
			});
			if (responseError || !data?.id) {
				throw new Error(responseError?.detail || m.onboarding_create_failed());
			}
			await workspaceCtx.loadWorkspaces(data.id);
			open = false;
			reset();
		} catch (cause) {
			error =
				cause instanceof Error && cause.message ? cause.message : m.onboarding_create_failed();
		} finally {
			pending = false;
		}
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content aria-busy={pending} showCloseButton={false} class="sm:max-w-md">
		<form onsubmit={createWorkspace} class="space-y-4">
			<Dialog.Header>
				<Dialog.Title>{m.onboarding_submit()}</Dialog.Title>
				<Dialog.Description>{m.onboarding_workspace_hint()}</Dialog.Description>
			</Dialog.Header>

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}

			<div class="space-y-2">
				<Label for="new-workspace-name">{m.onboarding_workspace_name()}</Label>
				<Input
					id="new-workspace-name"
					bind:value={workspaceName}
					placeholder={m.onboarding_workspace_placeholder()}
					disabled={pending}
					autocomplete="off"
					autofocus
				/>
			</div>

			<Dialog.Footer>
				<Button type="button" variant="outline" disabled={pending} onclick={close}>
					{m.common_cancel()}
				</Button>
				<Button type="submit" class="gap-2" disabled={!canCreate}>
					{#if pending}<LoaderIcon class="size-4 animate-spin" />{/if}
					{m.onboarding_submit()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
