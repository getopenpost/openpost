<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { client } from '$lib/api/client';
	import {
		oidcIdentitiesQueryOptions,
		OpenPostQueryError,
		securityStatusQueryOptions
	} from '@openpost/query-catalog';
	import { authQueryAPI } from '$lib/query/auth';
	import { queryClient } from '$lib/query/client';
	import { acquireReauthGrant } from '$lib/auth/reauth';
	import { m } from '$lib/paraglide/messages';
	import type { components } from '$lib/api/types';

	type DeletionPreview = components['schemas']['WorkspaceDeletionPreview'];
	type DeletionBlocker = components['schemas']['WorkspaceDeletionBlocker'];
	type Security = components['schemas']['SecurityStatusOutputBody'];
	type Identity = components['schemas']['OIDCIdentitySummary'];

	interface Props {
		open?: boolean;
		workspaceID: string;
		workspaceName: string;
		hasPassword: boolean;
		onConfirm: (
			workspaceID: string,
			confirmation: {
				confirmName: string;
				currentPassword: string;
				reauthGrant?: string;
			}
		) => void | boolean | Promise<void | boolean>;
	}

	let {
		open = $bindable(false),
		workspaceID,
		workspaceName,
		hasPassword,
		onConfirm
	}: Props = $props();
	let preview = $state<DeletionPreview | null>(null);
	let confirmName = $state('');
	let currentPassword = $state('');
	let error = $state('');
	let capabilityError = $state('');
	let pending = $state(false);
	let loading = $state(false);
	let loadedWorkspaceID = '';
	let hasPasskey = $state(false);
	let reauthProviderID = $state('');
	let previewRequestSequence = 0;

	const blockers = $derived(preview?.blockers ?? []);
	const canDelete = $derived(
		!loading &&
			!pending &&
			preview !== null &&
			loadedWorkspaceID === workspaceID &&
			blockers.length === 0 &&
			confirmName === preview.workspace_name &&
			(hasPassword ? currentPassword.length > 0 : Boolean(hasPasskey || reauthProviderID))
	);

	function impactMessage(item: string): string {
		switch (item) {
			case 'access':
				return m.workspace_delete_removed_access();
			case 'content':
				return m.workspace_delete_removed_content();
			case 'connected_assets':
				return m.workspace_delete_removed_assets();
			case 'required_records':
				return m.workspace_delete_retained_required_records();
			default:
				return item;
		}
	}

	function blockerMessage(blocker: DeletionBlocker): string {
		switch (blocker.code) {
			case 'final_workspace':
				return m.workspace_delete_blocker_final_workspace();
			case 'active_billing':
				return m.workspace_delete_blocker_active_billing();
			case 'pending_external_writes':
				return m.workspace_delete_blocker_pending_external_writes();
			case 'pending_cleanup':
				return m.workspace_delete_blocker_pending_cleanup();
			default:
				return blocker.message;
		}
	}

	function clearPreviewState() {
		preview = null;
		confirmName = '';
		currentPassword = '';
		error = '';
		capabilityError = '';
		hasPasskey = false;
		reauthProviderID = '';
	}

	async function loadPreview(targetWorkspaceID: string) {
		if (!targetWorkspaceID) return;
		const requestSequence = ++previewRequestSequence;
		loading = true;
		error = '';
		const capabilityPromise = hasPassword
			? Promise.resolve()
			: loadReauthCapabilities(targetWorkspaceID, requestSequence);
		try {
			const previewResult = await client.GET('/workspaces/{id}/deletion-preview', {
				params: { path: { id: targetWorkspaceID } }
			});
			await capabilityPromise;
			if (requestSequence !== previewRequestSequence || !open || workspaceID !== targetWorkspaceID)
				return;
			if (previewResult.error || !previewResult.data) {
				throw new Error(previewResult.error?.detail ?? m.workspace_delete_preview_failed());
			}
			preview = previewResult.data;
		} catch (cause) {
			if (requestSequence === previewRequestSequence && open && workspaceID === targetWorkspaceID) {
				error = cause instanceof Error ? cause.message : m.workspace_delete_preview_failed();
				preview = null;
			}
		} finally {
			if (requestSequence === previewRequestSequence && open && workspaceID === targetWorkspaceID)
				loading = false;
		}
	}

	async function loadReauthCapabilities(targetWorkspaceID: string, requestSequence: number) {
		const securityOptions = securityStatusQueryOptions(authQueryAPI);
		const identityOptions = oidcIdentitiesQueryOptions(authQueryAPI);
		const cachedSecurity = queryClient.getQueryData<Security>(securityOptions.queryKey);
		const cachedIdentities = queryClient.getQueryData<Identity[]>(identityOptions.queryKey);
		if (cachedSecurity !== undefined) hasPasskey = (cachedSecurity.passkeys?.length ?? 0) > 0;
		if (cachedIdentities !== undefined) {
			reauthProviderID = cachedIdentities.find((identity) => identity.active)?.provider_id ?? '';
		}
		const [securityResult, identityResult] = await Promise.allSettled([
			queryClient.fetchQuery(securityOptions),
			queryClient.fetchQuery(identityOptions)
		]);
		if (requestSequence !== previewRequestSequence || !open || workspaceID !== targetWorkspaceID)
			return;
		if (securityResult.status === 'fulfilled') {
			hasPasskey = (securityResult.value.passkeys?.length ?? 0) > 0;
		} else {
			handleCapabilityFailure(securityResult.reason, securityOptions.queryKey, () => {
				hasPasskey = false;
			});
		}
		if (identityResult.status === 'fulfilled') {
			reauthProviderID =
				identityResult.value.find((identity) => identity.active)?.provider_id ?? '';
		} else {
			handleCapabilityFailure(identityResult.reason, identityOptions.queryKey, () => {
				reauthProviderID = '';
			});
		}
	}

	function handleCapabilityFailure(
		cause: unknown,
		queryKey: readonly unknown[],
		clear: () => void
	) {
		if (cause instanceof OpenPostQueryError && (cause.status === 401 || cause.status === 403)) {
			queryClient.removeQueries({ queryKey, exact: true });
			clear();
		}
		capabilityError = cause instanceof Error ? cause.message : m.settings_action_failed();
	}

	function retryCapabilities() {
		capabilityError = '';
		void loadReauthCapabilities(workspaceID, previewRequestSequence);
	}

	function close() {
		if (pending) return;
		previewRequestSequence += 1;
		open = false;
		loading = false;
		clearPreviewState();
	}

	async function deleteWorkspace() {
		if (!canDelete) return;
		const targetWorkspaceID = loadedWorkspaceID;
		const requestSequence = previewRequestSequence;
		const confirmation = {
			confirmName,
			currentPassword
		};
		const targetHasPassword = hasPassword;
		const targetHasPasskey = hasPasskey;
		const targetProviderID = reauthProviderID;
		const isCurrentRequest = () =>
			requestSequence === previewRequestSequence &&
			open &&
			workspaceID === targetWorkspaceID &&
			loadedWorkspaceID === targetWorkspaceID;
		pending = true;
		error = '';
		const grant = targetHasPassword
			? ''
			: await acquireReauthGrant('workspace.delete', {
					providerID: targetProviderID,
					hasPasskey: targetHasPasskey,
					isCurrent: isCurrentRequest
				}).catch((cause: Error) => {
					if (isCurrentRequest()) error = cause.message;
					return undefined;
				});
		if (grant === null || grant === undefined) {
			pending = false;
			return;
		}
		if (!isCurrentRequest()) {
			pending = false;
			return;
		}
		try {
			const confirmed = await onConfirm(targetWorkspaceID, {
				...confirmation,
				reauthGrant: grant || undefined
			});
			if (confirmed === false) return;
			if (workspaceID === targetWorkspaceID) open = false;
		} catch (cause) {
			if (workspaceID === targetWorkspaceID) {
				error = cause instanceof Error ? cause.message : m.workspace_delete_failed();
			}
		} finally {
			pending = false;
		}
	}

	$effect(() => {
		if (!open) {
			previewRequestSequence += 1;
			loadedWorkspaceID = '';
			loading = false;
			clearPreviewState();
			return;
		}
		if (!workspaceID || loadedWorkspaceID === workspaceID) return;
		previewRequestSequence += 1;
		loadedWorkspaceID = workspaceID;
		loading = false;
		clearPreviewState();
		void loadPreview(workspaceID);
	});

	onDestroy(() => {
		previewRequestSequence += 1;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content aria-busy={loading || pending} showCloseButton={false} class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.workspace_delete_title()}</Dialog.Title>
			<Dialog.Description>{m.workspace_delete_dialog_description()}</Dialog.Description>
		</Dialog.Header>

		{#if loading}
			<div class="flex min-h-32 items-center justify-center" aria-label={m.common_loading()}>
				<LoaderIcon class="size-5 animate-spin" />
			</div>
		{:else}
			<div class="space-y-4">
				{#if preview}
					<div class="grid gap-3 sm:grid-cols-2">
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">
								{m.workspace_delete_removed_title()}
							</p>
							<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								{#each preview.removed ?? [] as item (item)}<li>
										{impactMessage(item)}
									</li>{/each}
							</ul>
						</section>
						<section class="rounded-md border p-3">
							<p class="text-sm font-medium">
								{m.workspace_delete_retained_title()}
							</p>
							<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
								{#each preview.retained ?? [] as item (item)}<li>
										{impactMessage(item)}
									</li>{/each}
							</ul>
						</section>
					</div>
					<InlineNotice
						tone="warning"
						message={preview.recovery_possible
							? m.workspace_delete_recovery_available()
							: m.workspace_delete_no_recovery()}
					/>
				{/if}

				{#if blockers.length > 0}
					<InlineNotice tone="warning">
						<p class="font-medium">{m.workspace_delete_blockers_title()}</p>
						<ul class="mt-1 list-disc space-y-1 pl-5">
							{#each blockers as blocker (blocker.code)}<li>
									{blockerMessage(blocker)}
								</li>{/each}
						</ul>
					</InlineNotice>
				{/if}

				{#if error}
					<InlineNotice tone="error" message={error}>
						{#if !preview}
							{#snippet actions()}
								<Button variant="outline" size="sm" onclick={() => void loadPreview(workspaceID)}
									>{m.common_retry()}</Button
								>
							{/snippet}
						{/if}
					</InlineNotice>
				{/if}
				{#if capabilityError && !hasPassword}
					<InlineNotice tone="warning" message={capabilityError}>
						{#snippet actions()}
							<Button variant="outline" size="sm" onclick={retryCapabilities}>
								{m.common_retry()}
							</Button>
						{/snippet}
					</InlineNotice>
				{/if}

				<div class="space-y-2">
					<Label for="workspace-delete-name"
						>{m.workspace_delete_name_label({
							name: preview?.workspace_name ?? workspaceName
						})}</Label
					>
					<Input
						id="workspace-delete-name"
						bind:value={confirmName}
						autocomplete="off"
						disabled={pending || blockers.length > 0}
					/>
				</div>

				{#if hasPassword}
					<div class="space-y-2">
						<Label for="workspace-delete-password">{m.settings_current_password()}</Label>
						<Input
							id="workspace-delete-password"
							type="password"
							bind:value={currentPassword}
							autocomplete="current-password"
							disabled={pending || blockers.length > 0}
						/>
					</div>
				{:else}
					<InlineNotice tone="info" message={m.settings_step_up_body()} />
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" class="w-full sm:w-auto" disabled={pending} onclick={close}>
				{m.common_cancel()}
			</Button>
			<Button
				variant="destructive"
				class="w-full gap-2 sm:w-auto"
				disabled={!canDelete}
				onclick={deleteWorkspace}
			>
				{#if pending}<LoaderIcon class="size-4 animate-spin" />{/if}
				{m.workspace_delete_confirm()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
