<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import {
		createVoiceProfileInput,
		replaceVoiceProfile,
		updateVoiceProfileInput,
		validateVoiceProfileDraft,
		voiceProfileAssignmentMap,
		voiceProfileDraft,
		voiceProfileDraftFingerprint,
		voiceProfilesCopy,
		type VoiceProfile,
		type VoiceProfileAccount,
		type VoiceProfileDraft,
		type VoiceProfilesClient,
		type VoiceProfilesCopy,
		type VoiceProfileValidationCode
	} from '$lib/voice-profiles';
	import VoiceAccountAssignments from './voice-account-assignments.svelte';
	import VoiceProfileEditor from './voice-profile-editor.svelte';
	import VoiceProfileList from './voice-profile-list.svelte';

	interface Props {
		workspaceId: string;
		client: VoiceProfilesClient;
		accounts?: VoiceProfileAccount[];
		accountsLoading?: boolean;
		initialProfiles?: VoiceProfile[];
		selectedProfileId?: string;
		active?: boolean;
		autoLoad?: boolean;
		canEdit?: boolean;
		showHeader?: boolean;
		copy?: Partial<VoiceProfilesCopy>;
		onProfilesChange?: (profiles: VoiceProfile[]) => void;
		onSelectionChange?: (profile: VoiceProfile | null) => void;
		onSaved?: (profile: VoiceProfile) => void;
		onDeleted?: (profileId: string) => void;
		onDefaultChange?: (profile: VoiceProfile) => void;
		onAssignmentChange?: (accountId: string, profileId: string | null) => void;
		onError?: (error: Error) => void;
	}

	let {
		workspaceId,
		client,
		accounts = [],
		accountsLoading = false,
		initialProfiles = [],
		selectedProfileId = $bindable(''),
		active = true,
		autoLoad = true,
		canEdit = true,
		showHeader = true,
		copy: copyOverrides = {},
		onProfilesChange,
		onSelectionChange,
		onSaved,
		onDeleted,
		onDefaultChange,
		onAssignmentChange,
		onError
	}: Props = $props();

	const seededProfiles = untrack(() => [...initialProfiles]);
	const seededSelection =
		seededProfiles.find((profile) => profile.id === selectedProfileId) ??
		seededProfiles.find((profile) => profile.isDefault) ??
		seededProfiles[0] ??
		null;
	const seededDraft = voiceProfileDraft(seededSelection);

	const copy = $derived(voiceProfilesCopy(copyOverrides));
	let profiles = $state.raw<VoiceProfile[]>(seededProfiles);
	let draft = $state.raw<VoiceProfileDraft>(seededDraft);
	let baselineFingerprint = $state(voiceProfileDraftFingerprint(seededDraft));
	let presentedWorkspaceId = $state(
		untrack(() => seededProfiles[0]?.workspaceId ?? workspaceId.trim())
	);
	let loadedWorkspaceId = $state('');
	let loading = $state(
		untrack(() => active && autoLoad && Boolean(workspaceId.trim()) && seededProfiles.length === 0)
	);
	let error = $state('');
	let operation = $state<'saving' | 'default' | 'deleting' | ''>('');
	let busyAccountId = $state('');
	let deleteOpen = $state(false);
	let requestSequence = 0;
	let requestController: AbortController | null = null;

	if (seededSelection && !selectedProfileId) selectedProfileId = seededSelection.id;

	const selectedProfile = $derived(
		profiles.find((profile) => profile.id === selectedProfileId) ?? null
	);
	const dirty = $derived(voiceProfileDraftFingerprint(draft) !== baselineFingerprint);
	const activeAccounts = $derived(accounts.filter((account) => account.active !== false));
	const assignments = $derived(
		voiceProfileAssignmentMap(
			profiles,
			activeAccounts.map((account) => account.id)
		)
	);

	function messageFor(cause: unknown, fallback: string): string {
		if (cause instanceof Error && cause.message) return cause.message;
		return fallback;
	}

	function report(cause: unknown, fallback: string): void {
		const next = cause instanceof Error ? cause : new Error(fallback);
		error = messageFor(next, fallback);
		onError?.(next);
	}

	function beginRequest(): AbortController {
		requestSequence += 1;
		requestController?.abort();
		const controller = new AbortController();
		requestController = controller;
		return controller;
	}

	function validationMessage(code: VoiceProfileValidationCode): string {
		if (code === 'name_required') return copy.nameRequired;
		if (code === 'name_too_long') return copy.nameTooLong;
		if (code === 'example_text_required') return copy.exampleTextRequired;
		if (code === 'correction_pair_required') return copy.correctionPairRequired;
		return copy.interviewPairRequired;
	}

	function selectLoadedProfile(profile: VoiceProfile | null): void {
		selectedProfileId = profile?.id ?? '';
		draft = voiceProfileDraft(profile);
		baselineFingerprint = voiceProfileDraftFingerprint(draft);
		onSelectionChange?.(profile);
	}

	function adoptProfiles(next: VoiceProfile[], preferredProfileId = selectedProfileId): void {
		profiles = [...next];
		const preferred = profiles.find((profile) => profile.id === preferredProfileId);
		const profile = preferred ?? profiles.find((item) => item.isDefault) ?? profiles[0] ?? null;
		selectLoadedProfile(profile);
		onProfilesChange?.(profiles);
	}

	async function loadProfiles(
		showLoading = true,
		preferredProfileId = selectedProfileId
	): Promise<void> {
		const targetWorkspaceId = workspaceId.trim();
		if (!targetWorkspaceId) return;
		if (presentedWorkspaceId && presentedWorkspaceId !== targetWorkspaceId) {
			profiles = [];
			selectLoadedProfile(null);
			onProfilesChange?.([]);
		}
		const controller = beginRequest();
		const sequence = requestSequence;
		if (showLoading) loading = true;
		error = '';
		try {
			const loaded = await client.list(targetWorkspaceId, { signal: controller.signal });
			if (sequence !== requestSequence) return;
			presentedWorkspaceId = targetWorkspaceId;
			loadedWorkspaceId = targetWorkspaceId;
			adoptProfiles(loaded, preferredProfileId);
		} catch (cause) {
			if (controller.signal.aborted || sequence !== requestSequence) return;
			loadedWorkspaceId = '';
			report(cause, copy.loadFailed);
		} finally {
			if (sequence === requestSequence) loading = false;
			if (requestController === controller) requestController = null;
		}
	}

	function chooseProfile(profile: VoiceProfile): void {
		if (profile.id === selectedProfileId) return;
		if (dirty) {
			error = copy.unsavedSwitch;
			return;
		}
		error = '';
		selectLoadedProfile(profile);
	}

	function beginCreate(): void {
		if (dirty) {
			error = copy.unsavedSwitch;
			return;
		}
		error = '';
		selectLoadedProfile(null);
	}

	function cancelEdit(): void {
		error = '';
		if (selectedProfile) {
			selectLoadedProfile(selectedProfile);
			return;
		}
		const fallback = profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;
		selectLoadedProfile(fallback);
	}

	async function saveProfile(): Promise<void> {
		if (!canEdit || operation) return;
		const issues = validateVoiceProfileDraft(draft);
		if (issues.length > 0) {
			error = validationMessage(issues[0]);
			return;
		}
		operation = 'saving';
		error = '';
		const controller = beginRequest();
		try {
			const saved = selectedProfile
				? await client.update(updateVoiceProfileInput(workspaceId, selectedProfile, draft), {
						signal: controller.signal
					})
				: await client.create(createVoiceProfileInput(workspaceId, draft), {
						signal: controller.signal
					});
			profiles = replaceVoiceProfile(profiles, saved);
			selectLoadedProfile(saved);
			onProfilesChange?.(profiles);
			onSaved?.(saved);
		} catch (cause) {
			if (!controller.signal.aborted) report(cause, copy.saveFailed);
		} finally {
			if (requestController === controller) requestController = null;
			operation = '';
		}
	}

	async function setDefault(): Promise<void> {
		if (!selectedProfile || selectedProfile.isDefault || dirty || !canEdit || operation) return;
		operation = 'default';
		error = '';
		const controller = beginRequest();
		try {
			const changed = await client.setDefault(
				{
					workspaceId,
					profileId: selectedProfile.id,
					expectedRevision: selectedProfile.revision
				},
				{ signal: controller.signal }
			);
			await loadProfiles(false, changed.id);
			onDefaultChange?.(changed);
		} catch (cause) {
			if (!controller.signal.aborted) report(cause, copy.defaultFailed);
		} finally {
			if (requestController === controller) requestController = null;
			operation = '';
		}
	}

	async function deleteProfile(): Promise<void> {
		const profile = selectedProfile;
		if (!profile || profile.isDefault || !canEdit || operation) return;
		operation = 'deleting';
		error = '';
		const controller = beginRequest();
		try {
			await client.delete(
				{
					workspaceId,
					profileId: profile.id,
					expectedRevision: profile.revision,
					confirm: true
				},
				{ signal: controller.signal }
			);
			deleteOpen = false;
			await loadProfiles(false, '');
			onDeleted?.(profile.id);
		} catch (cause) {
			if (!controller.signal.aborted) report(cause, copy.deleteFailed);
		} finally {
			if (requestController === controller) requestController = null;
			operation = '';
		}
	}

	async function assignAccount(account: VoiceProfileAccount, profileId: string): Promise<void> {
		if (!canEdit || busyAccountId || !profileId) return;
		const profile = profiles.find((item) => item.id === profileId);
		if (!profile) return;
		busyAccountId = account.id;
		error = '';
		const controller = beginRequest();
		const overrideProfileId = profile.isDefault ? null : profile.id;
		try {
			await client.assignAccount(
				{
					workspaceId,
					accountId: account.id,
					voiceProfileId: overrideProfileId
				},
				{ signal: controller.signal }
			);
			await loadProfiles(false, selectedProfileId);
			onAssignmentChange?.(account.id, overrideProfileId);
		} catch (cause) {
			if (!controller.signal.aborted) report(cause, copy.assignmentFailed);
		} finally {
			if (requestController === controller) requestController = null;
			busyAccountId = '';
		}
	}

	$effect(() => {
		const targetWorkspaceId = workspaceId.trim();
		if (!targetWorkspaceId) {
			untrack(() => {
				requestSequence += 1;
				requestController?.abort();
				requestController = null;
				loading = false;
				loadedWorkspaceId = '';
				presentedWorkspaceId = '';
				if (profiles.length > 0 || selectedProfileId) {
					profiles = [];
					selectLoadedProfile(null);
					onProfilesChange?.([]);
				}
			});
			return;
		}
		if (!active || !autoLoad || loadedWorkspaceId === targetWorkspaceId) return;
		untrack(
			() => void loadProfiles(profiles.length === 0 || presentedWorkspaceId !== targetWorkspaceId)
		);
	});

	onDestroy(() => {
		requestSequence += 1;
		requestController?.abort();
		requestController = null;
	});
</script>

<!--
THESIS: A Voice Profile is one reusable identity, not a platform preset or a wall of AI controls.
OWN-WORLD: OpenPost warm neutrals, flat bordered sections, compact fields, and one orange action or selection at a time.
STORY: The user chooses an identity, records the few facts that matter, adds evidence only when useful, then assigns accounts.
FIRST VIEWPORT: A short heading sits above a narrow profile list and one broad editor. Identity fields lead; advanced details stay closed.
FORM: Established settings extension in Operate mode, first choice; seed voice-profiles-progressive-settings.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->

<div class="space-y-6" data-testid="voice-profiles-settings">
	{#if showHeader}
		<SectionHeader title={copy.title} description={copy.description}>
			{#snippet actions()}
				<Button type="button" disabled={!canEdit || Boolean(operation)} onclick={beginCreate}>
					<PlusIcon class="size-4" />{copy.newProfile}
				</Button>
			{/snippet}
		</SectionHeader>
	{/if}

	{#if error}
		<InlineNotice
			tone="error"
			message={error}
			onDismiss={() => (error = '')}
			dismissLabel={copy.dismissError}
		>
			{#snippet actions()}
				{#if !loadedWorkspaceId}
					<Button type="button" variant="ghost" size="sm" onclick={() => void loadProfiles()}
						>{copy.retry}</Button
					>
				{/if}
			{/snippet}
		</InlineNotice>
	{/if}

	{#if loading && profiles.length === 0}
		<PageLoading layout="settings" label={copy.loading} />
	{:else}
		<div class="grid min-w-0 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
			<VoiceProfileList
				{profiles}
				{assignments}
				{selectedProfileId}
				{copy}
				disabled={Boolean(operation)}
				createDisabled={!canEdit || Boolean(operation)}
				onSelect={chooseProfile}
				onCreate={beginCreate}
			/>
			<VoiceProfileEditor
				{draft}
				profile={selectedProfile}
				{copy}
				{dirty}
				saving={operation === 'saving'}
				settingDefault={operation === 'default'}
				disabled={!canEdit || operation === 'deleting'}
				onChange={(next) => (draft = next)}
				onSave={() => void saveProfile()}
				onCancel={cancelEdit}
				onSetDefault={() => void setDefault()}
				onDelete={() => (deleteOpen = true)}
			/>
		</div>

		<VoiceAccountAssignments
			accounts={activeAccounts}
			{profiles}
			{assignments}
			{copy}
			{busyAccountId}
			loading={accountsLoading}
			disabled={!canEdit || Boolean(operation)}
			onAssign={(account, profileId) => void assignAccount(account, profileId)}
		/>
	{/if}
</div>

<Dialog.Root bind:open={deleteOpen}>
	<Dialog.Content aria-busy={operation === 'deleting'} showCloseButton={false} class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{copy.deleteTitle}</Dialog.Title>
			<Dialog.Description>{copy.deleteDescription(selectedProfile?.name ?? '')}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				type="button"
				variant="outline"
				class="w-full sm:w-auto"
				disabled={operation === 'deleting'}
				onclick={() => (deleteOpen = false)}>{copy.cancel}</Button
			>
			<Button
				type="button"
				variant="destructive"
				class="w-full sm:w-auto"
				disabled={operation === 'deleting'}
				onclick={() => void deleteProfile()}
			>
				{#if operation === 'deleting'}<LoaderIcon
						class="size-4 animate-spin motion-reduce:animate-none"
					/>{/if}
				{copy.deleteConfirm}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
