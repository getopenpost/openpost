<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	import DialogLoadingStatus from '$lib/components/dialog-loading-status.svelte';
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

	export interface ReauthDeleteBlocker {
		key: string;
		message: string;
	}

	export interface ReauthDeletePreviewSummary {
		blockers: ReauthDeleteBlocker[];
		expectedConfirm: string;
	}

	export interface ReauthDeletePayload {
		confirmText: string;
		currentPassword: string;
		reauthGrant?: string;
	}

	export interface ReauthDeleteDialogActions {
		reloadPreview: () => Promise<void>;
		busy: boolean;
		reportError: (message: string) => void;
	}

	type Security = components['schemas']['SecurityStatusOutputBody'];
	type Identity = components['schemas']['OIDCIdentitySummary'];

	interface Props {
		open?: boolean;
		entityID: string;
		title: string;
		description: string;
		confirmInputID: string;
		confirmLabelFor: (expected: string) => string;
		confirmPlaceholder?: string;
		confirmMode?: 'name' | 'email';
		passwordInputID: string;
		hasPassword: boolean;
		reauthAction: string;
		manageReauthCapabilities?: boolean;
		reauthProviderID?: string;
		hasPasskey?: boolean;
		previewLoader?: (
			entityID: string,
			isCurrent: () => boolean
		) => Promise<ReauthDeletePreviewSummary>;
		fallbackBlockers?: ReauthDeleteBlocker[];
		fallbackExpectedConfirm?: string;
		blockerTitle: string;
		confirmButtonLabel: string;
		pendingButtonLabel?: string;
		fallbackPreviewError: string;
		fallbackDeleteError: string;
		contentClass?: string;
		externalBusy?: boolean;
		onDelete: (payload: ReauthDeletePayload) => void | boolean | Promise<void | boolean>;
		preview?: Snippet;
		extraBlockerActions?: Snippet<[ReauthDeleteDialogActions]>;
		afterBlockers?: Snippet;
	}

	let {
		open = $bindable(false),
		entityID,
		title,
		description,
		confirmInputID,
		confirmLabelFor,
		confirmPlaceholder = '',
		confirmMode = 'name',
		passwordInputID,
		hasPassword,
		reauthAction,
		manageReauthCapabilities = true,
		reauthProviderID = '',
		hasPasskey = false,
		previewLoader,
		fallbackBlockers = [],
		fallbackExpectedConfirm = '',
		blockerTitle,
		confirmButtonLabel,
		pendingButtonLabel,
		fallbackPreviewError,
		fallbackDeleteError,
		contentClass = 'sm:max-w-lg',
		externalBusy = false,
		onDelete,
		preview,
		extraBlockerActions,
		afterBlockers
	}: Props = $props();

	let confirmText = $state('');
	let currentPassword = $state('');
	let error = $state('');
	let previewError = $state('');
	let capabilityError = $state('');
	let pending = $state(false);
	let loading = $state(false);
	let previewReady = $state(false);
	let loadedEntityID = '';
	let expectedConfirm = $state('');
	let loaderBlockers = $state<ReauthDeleteBlocker[]>([]);
	let internalHasPasskey = $state(false);
	let internalProviderID = $state('');
	let requestSequence = 0;

	const usePreviewLoader = $derived(previewLoader !== undefined);
	const blockers = $derived(usePreviewLoader ? loaderBlockers : fallbackBlockers);
	const expected = $derived(usePreviewLoader ? expectedConfirm : fallbackExpectedConfirm);
	const effectiveHasPasskey = $derived(manageReauthCapabilities ? internalHasPasskey : hasPasskey);
	const effectiveProviderID = $derived(
		manageReauthCapabilities ? internalProviderID : reauthProviderID
	);
	const confirmMatches = $derived(
		expected.trim().length > 0 &&
			(confirmMode === 'email'
				? confirmText.trim().toLowerCase() === expected.trim().toLowerCase()
				: confirmText === expected)
	);
	const busy = $derived(pending || externalBusy);
	const canDelete = $derived(
		!loading &&
			!busy &&
			(!usePreviewLoader || (previewReady && loadedEntityID === entityID)) &&
			blockers.length === 0 &&
			confirmMatches &&
			(hasPassword
				? currentPassword.length > 0
				: Boolean(effectiveHasPasskey || effectiveProviderID))
	);

	function clearDialogState() {
		confirmText = '';
		currentPassword = '';
		error = '';
		previewError = '';
		capabilityError = '';
		expectedConfirm = '';
		loaderBlockers = [];
		previewReady = false;
		internalHasPasskey = false;
		internalProviderID = '';
	}

	async function loadPreview(targetEntityID: string) {
		const loader = previewLoader;
		if (!targetEntityID || !loader) return;
		const sequence = ++requestSequence;
		loading = true;
		previewError = '';
		const capabilityPromise =
			hasPassword || !manageReauthCapabilities
				? Promise.resolve()
				: loadReauthCapabilities(targetEntityID, sequence);
		try {
			const summary = await loader(
				targetEntityID,
				() => sequence === requestSequence && open && entityID === targetEntityID
			);
			await capabilityPromise;
			if (sequence !== requestSequence || !open || entityID !== targetEntityID) return;
			loaderBlockers = summary.blockers;
			expectedConfirm = summary.expectedConfirm;
			previewReady = true;
		} catch (cause) {
			if (sequence === requestSequence && open && entityID === targetEntityID) {
				previewError = cause instanceof Error ? cause.message : fallbackPreviewError;
				loaderBlockers = [];
				expectedConfirm = '';
				previewReady = false;
			}
		} finally {
			if (sequence === requestSequence && open && entityID === targetEntityID) loading = false;
		}
	}

	async function loadReauthCapabilities(targetEntityID: string, sequence: number) {
		const securityOptions = securityStatusQueryOptions(authQueryAPI);
		const identityOptions = oidcIdentitiesQueryOptions(authQueryAPI);
		const cachedSecurity = queryClient.getQueryData<Security>(securityOptions.queryKey);
		const cachedIdentities = queryClient.getQueryData<Identity[]>(identityOptions.queryKey);
		if (cachedSecurity !== undefined)
			internalHasPasskey = (cachedSecurity.passkeys?.length ?? 0) > 0;
		if (cachedIdentities !== undefined) {
			internalProviderID = cachedIdentities.find((identity) => identity.active)?.provider_id ?? '';
		}
		const [securityResult, identityResult] = await Promise.allSettled([
			queryClient.fetchQuery(securityOptions),
			queryClient.fetchQuery(identityOptions)
		]);
		if (sequence !== requestSequence || !open || entityID !== targetEntityID) return;
		if (securityResult.status === 'fulfilled') {
			internalHasPasskey = (securityResult.value.passkeys?.length ?? 0) > 0;
		} else {
			handleCapabilityFailure(securityResult.reason, securityOptions.queryKey, () => {
				internalHasPasskey = false;
			});
		}
		if (identityResult.status === 'fulfilled') {
			internalProviderID =
				identityResult.value.find((identity) => identity.active)?.provider_id ?? '';
		} else {
			handleCapabilityFailure(identityResult.reason, identityOptions.queryKey, () => {
				internalProviderID = '';
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
		void loadReauthCapabilities(entityID, requestSequence);
	}

	async function reloadPreview() {
		if (!previewLoader || !entityID) return;
		await loadPreview(entityID);
	}

	function close() {
		if (busy) return;
		requestSequence += 1;
		open = false;
		loading = false;
		clearDialogState();
	}

	async function deleteEntity() {
		if (!canDelete) return;
		const targetEntityID = usePreviewLoader ? loadedEntityID : entityID;
		const sequence = requestSequence;
		const confirmation = {
			confirmText,
			currentPassword
		};
		const targetHasPassword = hasPassword;
		const targetHasPasskey = effectiveHasPasskey;
		const targetProviderID = effectiveProviderID;
		const isCurrentRequest = () =>
			sequence === requestSequence &&
			open &&
			entityID === targetEntityID &&
			(!usePreviewLoader || loadedEntityID === targetEntityID);
		pending = true;
		error = '';
		const grant = targetHasPassword
			? ''
			: await acquireReauthGrant(reauthAction, {
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
			const confirmed = await onDelete({
				...confirmation,
				reauthGrant: grant || undefined
			});
			if (confirmed === false) return;
			if (entityID === targetEntityID) open = false;
		} catch (cause) {
			if (entityID === targetEntityID) {
				error = cause instanceof Error ? cause.message : fallbackDeleteError;
			}
		} finally {
			pending = false;
		}
	}

	$effect(() => {
		if (!open) {
			requestSequence += 1;
			loadedEntityID = '';
			loading = false;
			clearDialogState();
			return;
		}
		if (!entityID || loadedEntityID === entityID) return;
		requestSequence += 1;
		loadedEntityID = entityID;
		loading = false;
		clearDialogState();
		if (previewLoader) void loadPreview(entityID);
	});

	onDestroy(() => {
		requestSequence += 1;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		aria-busy={loading || busy}
		escapeKeydownBehavior={busy ? 'ignore' : 'close'}
		interactOutsideBehavior={busy ? 'ignore' : 'close'}
		showCloseButton={false}
		class={contentClass}
	>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>

		{#if loading}
			<DialogLoadingStatus />
		{:else}
			<div class="space-y-4">
				{@render preview?.()}

				{#if blockers.length > 0}
					<InlineNotice tone="warning">
						<p class="font-medium">{blockerTitle}</p>
						<ul class="mt-1 list-disc space-y-1 ps-5">
							{#each blockers as blocker (blocker.key)}<li>
									{blocker.message}
								</li>{/each}
						</ul>
						{#if extraBlockerActions}
							{@render extraBlockerActions({
								reloadPreview,
								busy,
								reportError: (message: string) => {
									error = message;
								}
							})}
						{/if}
					</InlineNotice>
				{/if}

				{@render afterBlockers?.()}

				{#if previewError}
					<InlineNotice tone="error" message={previewError}>
						{#snippet actions()}
							<Button variant="outline" size="sm" onclick={() => void reloadPreview()}
								>{m.common_retry()}</Button
							>
						{/snippet}
					</InlineNotice>
				{/if}
				{#if error}
					<InlineNotice tone="error" message={error} />
				{/if}
				{#if capabilityError && !hasPassword && manageReauthCapabilities}
					<InlineNotice tone="warning" message={capabilityError}>
						{#snippet actions()}
							<Button variant="outline" size="sm" onclick={retryCapabilities}>
								{m.common_retry()}
							</Button>
						{/snippet}
					</InlineNotice>
				{/if}

				<div class="space-y-2">
					<Label for={confirmInputID}>{confirmLabelFor(expected)}</Label>
					<Input
						id={confirmInputID}
						type={confirmMode === 'email' ? 'email' : 'text'}
						bind:value={confirmText}
						autocomplete="off"
						placeholder={confirmPlaceholder || undefined}
						disabled={busy || blockers.length > 0}
					/>
				</div>

				{#if hasPassword}
					<div class="space-y-2">
						<Label for={passwordInputID}>{m.settings_current_password()}</Label>
						<Input
							id={passwordInputID}
							type="password"
							bind:value={currentPassword}
							autocomplete="current-password"
							disabled={busy || blockers.length > 0}
						/>
					</div>
				{:else}
					<InlineNotice tone="info" message={m.settings_step_up_body()} />
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" class="w-full sm:w-auto" disabled={busy} onclick={close}>
				{m.common_cancel()}
			</Button>
			<Button
				variant="destructive"
				class="w-full gap-2 sm:w-auto"
				disabled={!canDelete}
				onclick={deleteEntity}
			>
				{#if busy}<ProtectedIcon
						icon="loading"
						class="size-4 animate-spin motion-reduce:animate-none"
					/>{/if}
				{busy && pendingButtonLabel ? pendingButtonLabel : confirmButtonLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
