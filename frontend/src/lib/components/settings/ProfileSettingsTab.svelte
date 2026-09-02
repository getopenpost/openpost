<script lang="ts">
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { auth } from '$lib/stores/auth';
	import { resolveAppPath } from '$lib/app-path';
	import { client } from '$lib/api/client';
	import { showToast } from '$lib/toast';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import ProfileAvatarUploader from '$lib/components/profile-avatar-uploader.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import { buildProfileUpdateBody } from '../../../routes/settings/settings-data';
	import { m } from '$lib/paraglide/messages';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		adminQueryKeys,
		authConfigurationQueryOptions,
		publicProfileQueryKeys
	} from '@openpost/query-catalog';
	import { authQueryAPI } from '$lib/query/auth';
	import { queryClient } from '$lib/query/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';

	type AppearanceMode = 'system' | 'light' | 'dark';
	const publicProfileFieldIDs = [
		'display_name',
		'avatar',
		'joined_at',
		'activity',
		'platforms',
		'workspaces',
		'plan'
	] as const;

	const authState = $derived($auth);
	const unsavedChanges = getOptionalUnsavedChanges();
	let profileDisplayName = $state('');
	let profileUsername = $state('');
	let profilePublic = $state(false);
	let profileVisibleFields = $state.raw<string[]>([]);
	let savedProfileDisplayName = $state('');
	let savedProfileUsername = $state('');
	let savedProfilePublic = $state(false);
	let savedProfileVisibleFields = $state.raw<string[]>([]);
	let profileBusy = $state(false);
	let profileError = $state('');
	let avatarUploaderOpen = $state(false);
	let lastProfileUserID = $state('');
	let avatarUploaderUserID = '';
	let avatarUploaderOpenedGeneration = 0;
	let avatarUploaderGeneration = 0;
	let profileMutationGeneration = 0;
	let mounted = true;
	const authConfigurationQuery = createQuery(() => authConfigurationQueryOptions(authQueryAPI));
	const publicProfilesAvailable = $derived(
		authConfigurationQuery.data?.public_profiles_enabled ?? null
	);
	const publicProfilesError = $derived(authConfigurationQuery.error?.message ?? '');

	const profileEmail = $derived(authState.user?.email ?? '');
	const profileAvatarURL = $derived(authState.user?.avatar_url ?? '');
	const profileDirty = $derived(
		profileDisplayName !== savedProfileDisplayName ||
			profileUsername !== savedProfileUsername ||
			(publicProfilesAvailable === true &&
				(profilePublic !== savedProfilePublic ||
					sortedValues(profileVisibleFields) !== sortedValues(savedProfileVisibleFields)))
	);
	const selectedPublicProfileFields = $derived(
		publicProfileFieldIDs.filter((field) => profileVisibleFields.includes(field))
	);
	const profileInitials = $derived(initials(profileDisplayName || profileEmail || 'OP'));
	const publicProfilePreviewInitials = $derived(
		initials(
			(profileVisibleFields.includes('display_name') ? profileDisplayName : '') ||
				profileUsername ||
				'OP'
		)
	);

	function initials(value: string) {
		const parts = value
			.replace(/@.*/, '')
			.split(/[\s._-]+/)
			.filter(Boolean);
		return (parts[0]?.[0] ?? 'O').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
	}

	function sortedValues(values: readonly string[] | undefined) {
		return [...(values ?? [])].sort().join('\u0000');
	}

	function notify(message: string, tone: 'success' | 'error' = 'success') {
		showToast(message, tone);
	}

	function publicProfileFieldLabel(field: string) {
		if (field === 'display_name') return m.settings_public_field_display_name();
		if (field === 'avatar') return m.settings_public_field_avatar();
		if (field === 'joined_at') return m.settings_public_field_joined_at();
		if (field === 'activity') return m.settings_public_field_activity();
		if (field === 'platforms') return m.settings_public_field_platforms();
		if (field === 'workspaces') return m.settings_public_field_workspaces();
		if (field === 'plan') return m.settings_public_field_plan();
		return field;
	}

	function appearanceLabel(mode: AppearanceMode) {
		if (mode === 'light') return m.sidebar_appearance_light();
		if (mode === 'dark') return m.sidebar_appearance_dark();
		return m.sidebar_appearance_system();
	}

	function togglePublicProfileField(field: string, checked: boolean) {
		profileVisibleFields = checked
			? [...new Set([...profileVisibleFields, field])]
			: profileVisibleFields.filter((value) => value !== field);
	}

	function evictPublicProfiles(...usernames: Array<string | null | undefined>) {
		const normalizedUsernames = usernames.flatMap((value) => {
			const username = value?.trim();
			return username ? [username] : [];
		});
		for (const username of new Set(normalizedUsernames)) {
			queryClient.removeQueries({
				queryKey: publicProfileQueryKeys.detail(username),
				exact: true
			});
		}
	}

	function profileMutationIsCurrent(userID: string, generation: number) {
		return (
			generation === profileMutationGeneration &&
			authState.user?.id === userID &&
			lastProfileUserID === userID
		);
	}

	function openAvatarUploader() {
		const userID = get(auth).user?.id ?? '';
		if (!userID) return;
		avatarUploaderUserID = userID;
		avatarUploaderOpenedGeneration = ++avatarUploaderGeneration;
		avatarUploaderOpen = true;
	}

	function avatarUploadIsCurrent() {
		return (
			mounted &&
			avatarUploaderOpenedGeneration === avatarUploaderGeneration &&
			get(auth).user?.id === avatarUploaderUserID &&
			lastProfileUserID === avatarUploaderUserID
		);
	}

	async function saveProfile(event: SubmitEvent) {
		event.preventDefault();
		const userID = authState.user?.id ?? '';
		if (!userID || userID !== lastProfileUserID) return;
		const generation = profileMutationGeneration;
		const previousUsername = authState.user?.username;
		const body = buildProfileUpdateBody({
			displayName: profileDisplayName,
			username: profileUsername,
			publicProfilesAvailable,
			publicProfileEnabled: profilePublic,
			publicProfileVisibleFields: [...profileVisibleFields]
		});
		profileBusy = true;
		profileError = '';
		try {
			const { data, error } = await client.PATCH('/auth/profile', {
				body
			});
			if (error || !data) throw new Error(error?.detail || m.settings_action_failed());
			const currentUser = get(auth).user;
			if (currentUser?.id !== userID) return;
			auth.setUser({
				...currentUser,
				display_name: data.display_name,
				username: data.username,
				public_profile_enabled: data.public_profile_enabled,
				public_profile_visible_fields: data.public_profile_visible_fields
			});
			evictPublicProfiles(previousUsername, data.username);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: adminQueryKeys.usersRoot() }),
				queryClient.invalidateQueries({
					queryKey: adminQueryKeys.aiPrompts(),
					exact: true
				})
			]);
			if (!profileMutationIsCurrent(userID, generation)) return;
			profileDisplayName = data.display_name ?? '';
			profileUsername = data.username ?? '';
			profilePublic = Boolean(data.public_profile_enabled);
			profileVisibleFields = [...(data.public_profile_visible_fields ?? publicProfileFieldIDs)];
			savedProfileDisplayName = profileDisplayName;
			savedProfileUsername = profileUsername;
			savedProfilePublic = profilePublic;
			savedProfileVisibleFields = [...profileVisibleFields];
			notify(m.settings_profile_updated());
		} catch (error) {
			if (profileMutationIsCurrent(userID, generation)) {
				profileError = error instanceof Error ? error.message : m.settings_action_failed();
			}
		} finally {
			if (profileMutationIsCurrent(userID, generation)) profileBusy = false;
		}
	}

	function handleAvatarUploaded(avatarURL: string) {
		const actorID = avatarUploaderUserID;
		const user = get(auth).user;
		if (!actorID || user?.id !== actorID) return;
		evictPublicProfiles(user.username);
		auth.setUser({ ...user, avatar_url: avatarURL });
		void queryClient.invalidateQueries({
			queryKey: adminQueryKeys.usersRoot()
		});
		if (!avatarUploadIsCurrent()) return;
		notify(m.settings_picture_updated());
	}

	async function reconcileUncertainAvatarUpload() {
		const actorID = avatarUploaderUserID;
		const user = get(auth).user;
		if (!actorID || user?.id !== actorID) return;
		evictPublicProfiles(user.username);
		void queryClient.invalidateQueries({
			queryKey: adminQueryKeys.usersRoot()
		});
		const projection = auth.captureUserProjection(actorID);
		if (!projection) return;
		try {
			const bootstrap = await workspaceCtx.loadWorkspaces(workspaceCtx.currentWorkspace?.id);
			if (get(auth).user?.id === actorID) auth.projectBootstrap(bootstrap, projection);
		} catch {
			// The invalidated bootstrap retries when the next owner mounts.
		}
	}

	async function removeAvatar() {
		if (!profileAvatarURL) return;
		const user = authState.user;
		if (!user || user.id !== lastProfileUserID) return;
		const generation = profileMutationGeneration;
		profileBusy = true;
		profileError = '';
		try {
			const { error } = await client.DELETE('/auth/profile/avatar', {});
			if (error) throw new Error(error.detail || m.settings_action_failed());
			const currentUser = get(auth).user;
			if (currentUser?.id !== user.id) return;
			evictPublicProfiles(currentUser.username);
			auth.setUser({ ...currentUser, avatar_url: '' });
			await queryClient.invalidateQueries({
				queryKey: adminQueryKeys.usersRoot()
			});
			if (!profileMutationIsCurrent(user.id, generation)) return;
			notify(m.settings_picture_removed());
		} catch (error) {
			if (profileMutationIsCurrent(user.id, generation)) {
				profileError = error instanceof Error ? error.message : m.settings_action_failed();
			}
		} finally {
			if (profileMutationIsCurrent(user.id, generation)) profileBusy = false;
		}
	}

	$effect(() => {
		const user = authState.user;
		const userID = user?.id ?? '';
		const actorChanged = userID !== lastProfileUserID;
		const preserveDraft = !actorChanged && profileDirty;
		if (actorChanged) {
			profileMutationGeneration += 1;
			lastProfileUserID = userID;
			avatarUploaderUserID = '';
			avatarUploaderOpen = false;
			profileBusy = false;
			profileError = '';
		}
		if (user && userID) {
			const displayName = user.display_name || '';
			const username = user.username || '';
			const publicProfile = Boolean(user.public_profile_enabled);
			const visibleFields = [...(user.public_profile_visible_fields ?? publicProfileFieldIDs)];
			savedProfileDisplayName = displayName;
			savedProfileUsername = username;
			savedProfilePublic = publicProfile;
			savedProfileVisibleFields = visibleFields;
			if (!preserveDraft) {
				profileDisplayName = displayName;
				profileUsername = username;
				profilePublic = publicProfile;
				profileVisibleFields = [...visibleFields];
			}
		} else {
			savedProfileDisplayName = '';
			savedProfileUsername = '';
			savedProfilePublic = false;
			savedProfileVisibleFields = [];
			profileDisplayName = '';
			profileUsername = '';
			profilePublic = false;
			profileVisibleFields = [];
		}
	});

	onDestroy(() => {
		mounted = false;
		avatarUploaderGeneration += 1;
		profileMutationGeneration += 1;
	});

	$effect(() => {
		unsavedChanges?.set('profile-settings', profileDirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('profile-settings');
	});
</script>

{#if avatarUploaderOpen}
	<ProfileAvatarUploader
		bind:open={avatarUploaderOpen}
		onComplete={handleAvatarUploaded}
		onUncertain={() => void reconcileUncertainAvatarUpload()}
		onError={(message) => {
			if (avatarUploadIsCurrent()) profileError = message;
		}}
	/>
{/if}

<form onsubmit={saveProfile} class="space-y-6">
	<div class="flex flex-col gap-6 sm:flex-row sm:items-center">
		<div class="group relative h-24 w-24 shrink-0">
			{#if profileAvatarURL}
				<img
					src={profileAvatarURL}
					alt={m.settings_profile_avatar_alt()}
					class="h-24 w-24 rounded-full border bg-muted object-cover"
				/>
			{:else}
				<div
					class="flex h-24 w-24 items-center justify-center rounded-full border border-dashed bg-muted text-xl font-semibold text-muted-foreground"
				>
					{profileInitials}
				</div>
			{/if}
			<button
				type="button"
				data-cuelume-toggle="release"
				onclick={openAvatarUploader}
				class="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:inset-auto [@media(pointer:coarse)]:right-0 [@media(pointer:coarse)]:bottom-0 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:border-2 [@media(pointer:coarse)]:border-background [@media(pointer:coarse)]:opacity-100"
				aria-label={m.settings_change_profile_picture()}
			>
				<CameraIcon class="h-6 w-6" />
			</button>
		</div>
		<div class="min-w-0 flex-1 space-y-3">
			<div class="space-y-2">
				<Label for="profile-display-name">{m.settings_display_name()}</Label>
				<Input
					id="profile-display-name"
					bind:value={profileDisplayName}
					placeholder={m.settings_your_name()}
					maxlength={120}
				/>
			</div>
			<div class="space-y-2">
				<Label for="profile-username">{m.settings_username()}</Label>
				<div class="relative">
					<span
						class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
						aria-hidden="true">@</span
					>
					<Input
						id="profile-username"
						bind:value={profileUsername}
						class="pl-7"
						required
						minlength={3}
						maxlength={30}
						pattern="[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?"
						autocomplete="username"
						aria-describedby="profile-username-help"
					/>
				</div>
				<p id="profile-username-help" class="text-xs leading-5 text-muted-foreground">
					{m.settings_username_help()}
				</p>
			</div>
			<p class="text-sm text-muted-foreground">{profileEmail}</p>
			<div class="flex flex-wrap gap-2">
				<Button type="button" variant="outline" onclick={openAvatarUploader}
					><CameraIcon class="mr-2 h-4 w-4" />{m.settings_change_picture()}</Button
				>
				{#if profileAvatarURL}<Button
						type="button"
						variant="ghost"
						class="text-destructive hover:text-destructive"
						onclick={removeAvatar}
						disabled={profileBusy}><TrashIcon class="mr-2 h-4 w-4" />{m.settings_remove()}</Button
					>{/if}
			</div>
		</div>
	</div>

	<div class="rounded-xl border bg-muted/20 p-4">
		<div class="mb-1 flex items-center justify-between gap-3">
			<p class="font-medium">{m.settings_private_account_details()}</p>
			<span class="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
				>{m.settings_account_scope()}</span
			>
		</div>
		<p class="text-sm leading-6 text-muted-foreground">
			{m.settings_private_account_details_description()}
		</p>
		<p class="mt-3 text-sm font-medium break-all">{profileEmail}</p>
	</div>
	{#if publicProfilesError}
		<InlineNotice
			tone={publicProfilesAvailable === null ? 'error' : 'warning'}
			message={publicProfilesError}
		>
			{#snippet actions()}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={() => void authConfigurationQuery.refetch()}
				>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{/if}

	{#if publicProfilesAvailable === false}
		<InlineNotice tone="info" message={m.settings_public_profile_unavailable()} />
	{:else if publicProfilesAvailable === true}
		<div class="space-y-5 rounded-xl border bg-muted/25 p-4">
			<div class="flex items-start gap-3">
				<Checkbox
					id="profile-public"
					bind:checked={profilePublic}
					aria-describedby="profile-public-description"
				/>
				<div class="min-w-0 flex-1">
					<Label for="profile-public" class="font-medium">{m.settings_public_profile()}</Label>
					<p id="profile-public-description" class="mt-1 text-sm leading-6 text-muted-foreground">
						{m.settings_public_profile_description()}
					</p>
					{#if authState.user?.public_profile_enabled && authState.user.username}
						<a
							href={resolveAppPath(`/u/${authState.user.username}`)}
							target="_blank"
							rel="noreferrer"
							class="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
							>{m.settings_view_public_profile()}<ExternalLinkIcon
								class="size-4"
								aria-hidden="true"
							/></a
						>
					{/if}
				</div>
			</div>
			<div class="space-y-3 border-t pt-4">
				<div>
					<p class="text-sm font-medium">
						{m.settings_public_profile_fields()}
					</p>
					<p class="mt-1 text-sm leading-6 text-muted-foreground">
						{m.settings_public_profile_fields_description()}
					</p>
				</div>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each publicProfileFieldIDs as field (field)}
						<div class="flex min-h-11 items-center gap-3 rounded-md border bg-background px-3 py-2">
							<Checkbox
								id={`public-profile-field-${field}`}
								checked={profileVisibleFields.includes(field)}
								onCheckedChange={(checked) => togglePublicProfileField(field, checked)}
							/><Label for={`public-profile-field-${field}`} class="font-normal"
								>{publicProfileFieldLabel(field)}</Label
							>
						</div>
					{/each}
				</div>
				{#if profileVisibleFields.includes('workspaces')}<InlineNotice
						tone="warning"
						message={m.settings_public_profile_workspace_warning()}
					/>{/if}
			</div>
			<div class="rounded-lg border bg-background p-4" data-testid="public-profile-preview">
				<p class="mb-3 text-sm font-medium">
					{m.settings_public_profile_preview()}
				</p>
				<div class="flex items-center gap-3">
					{#if profileAvatarURL && profileVisibleFields.includes('avatar')}<img
							src={profileAvatarURL}
							alt=""
							class="size-12 rounded-full border bg-muted object-cover"
						/>{:else}<div
							class="flex size-12 items-center justify-center rounded-full border bg-muted font-semibold"
						>
							{publicProfilePreviewInitials}
						</div>{/if}
					<div class="min-w-0">
						{#if profileVisibleFields.includes('display_name') && profileDisplayName}<p
								class="truncate font-medium"
							>
								{profileDisplayName}
							</p>{/if}
						<p class="truncate text-sm text-muted-foreground">
							@{profileUsername}
						</p>
					</div>
				</div>
				{#if !profilePublic}<p class="mt-3 text-sm text-muted-foreground">
						{m.settings_public_profile_preview_private()}
					</p>{:else if selectedPublicProfileFields.length}<div class="mt-3 flex flex-wrap gap-2">
						{#each selectedPublicProfileFields as field (field)}<span
								class="rounded-full border px-2 py-1 text-xs text-muted-foreground"
								>{publicProfileFieldLabel(field)}</span
							>{/each}
					</div>{/if}
			</div>
		</div>
	{:else if !publicProfilesError}
		<p class="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground" aria-live="polite">
			{m.common_loading()}
		</p>
	{/if}

	{#if profileError}<InlineNotice tone="error" message={profileError} />{/if}
	<SettingsFormFooter
		label={m.settings_save_profile()}
		savingLabel={m.settings_save_profile()}
		saving={profileBusy}
		disabled={!profileDirty}
		type="submit"
	/>
</form>

<div class="mt-8 border-t pt-6">
	<SectionHeader
		title={m.settings_personal_preferences()}
		description={m.settings_personal_preferences_description()}
		icon={PaletteIcon}
		class="mb-4"
		>{#snippet actions()}<span class="rounded-full border px-2 py-1 text-xs text-muted-foreground"
				>{m.settings_browser_scope()}</span
			>{/snippet}</SectionHeader
	>
	<div class="grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
		<div class="space-y-2">
			<Label for="personal-appearance">{m.settings_appearance()}</Label><Select.Root
				type="single"
				value={userPrefersMode.current}
				onValueChange={(value) => value && setMode(value as AppearanceMode)}
				><Select.Trigger id="personal-appearance" class="w-full"
					>{appearanceLabel(userPrefersMode.current as AppearanceMode)}</Select.Trigger
				><Select.Content
					>{#each ['system', 'light', 'dark'] as appearance (appearance)}<Select.Item
							value={appearance}>{appearanceLabel(appearance as AppearanceMode)}</Select.Item
						>{/each}</Select.Content
				></Select.Root
			>
		</div>
		<div class="space-y-2">
			<Label>{m.settings_language()}</Label>
			<div class="flex min-h-10 items-center"><LanguageSwitcher /></div>
		</div>
		<div
			class="flex items-start gap-3 rounded-md border bg-muted/20 p-3 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-7"
		>
			<Checkbox
				id="personal-interface-sounds"
				data-cuelume-toggle={undefined}
				checked={soundPreferences.enabled}
				onCheckedChange={(checked) => soundPreferences.setEnabled(checked)}
			/>
			<div>
				<Label for="personal-interface-sounds">{m.settings_interface_sounds()}</Label>
				<p class="mt-1 text-xs text-muted-foreground">
					{m.settings_interface_sounds_description()}
				</p>
			</div>
		</div>
	</div>
</div>
