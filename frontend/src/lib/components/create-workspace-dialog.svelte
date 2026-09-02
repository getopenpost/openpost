<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { auth } from '$lib/stores/auth';
	import { get } from 'svelte/store';
	import { workspaceCreationCachePlan } from '@openpost/query-catalog';
	import { executeQueryCachePlan } from '$lib/query/cache-plan';
	import { queryClient } from '$lib/query/client';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
	}

	let { open = $bindable(false) }: Props = $props();
	let workspaceName = $state('');
	let error = $state('');
	let pending = $state(false);
	let requestSequence = 0;
	let active = true;
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
		const actorID = get(auth).user?.id ?? '';
		if (!actorID) {
			pending = false;
			return;
		}
		const sequence = ++requestSequence;
		const isSameActor = () => get(auth).user?.id === actorID;
		const isCurrentRequest = () => active && sequence === requestSequence && open && isSameActor();
		try {
			const organizationID = workspaceCtx.currentWorkspace?.organization_id?.trim() ?? '';
			const body: components['schemas']['CreateWorkspaceInputBody'] = { name };
			if (organizationID) body.organization_id = organizationID;
			const { data, error: responseError } = await client.POST('/workspaces', {
				body
			});
			if (responseError || !data?.id) {
				throw new Error(responseError?.detail || m.onboarding_create_failed());
			}
			if (!isSameActor()) return;
			await executeQueryCachePlan(queryClient, workspaceCreationCachePlan());
			const projection = auth.captureUserProjection(actorID);
			if (!projection) return;
			const bootstrap = await workspaceCtx.loadWorkspaces(data.id, {
				selectionIsCurrent: isCurrentRequest
			});
			if (!isSameActor() || !auth.projectBootstrap(bootstrap, projection)) return;
			if (!isCurrentRequest()) return;
			open = false;
			reset();
		} catch (cause) {
			if (isCurrentRequest()) {
				error =
					cause instanceof Error && cause.message ? cause.message : m.onboarding_create_failed();
			}
		} finally {
			if (isCurrentRequest()) pending = false;
		}
	}

	$effect(() => {
		if (open) return;
		requestSequence += 1;
		pending = false;
	});

	onDestroy(() => {
		active = false;
		requestSequence += 1;
	});
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
