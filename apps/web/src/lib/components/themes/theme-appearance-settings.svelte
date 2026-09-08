<script lang="ts">
	import { createInfiniteQuery, createQueries, createQuery } from '@tanstack/svelte-query';
	import { mode, setMode } from 'mode-watcher';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';

	import { themeMutationCachePlan } from '@openpost/query-catalog';
	import { client } from '$lib/api/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent
	} from '$lib/query/authorization-boundary';
	import { reconcileQueryMutation } from '$lib/query/mutation-reconciliation';
	import { queryClient } from '$lib/query/client';
	import {
		themeAvailableThemesOptions,
		themeOrganizationThemeOptions,
		themeOrganizationThemesInfiniteOptions,
		themeAvailableThemeOptions,
		themeRevisionsOptions,
		themeSettingsOptions
	} from '$lib/query/themes';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import PageLoading from '$lib/components/page-loading.svelte';
	import ThemeEditor from './theme-editor.svelte';
	import ThemeLibrary from './theme-library.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import type { ThemeManifest } from '$lib/themes';
	import type { CreateThemeInput, ThemeLibraryItem } from './theme-library-types';
	import type { ThemeReference } from './theme-library-model';
	import type { ThemeRevisionItem } from './theme-editor-types';
	import type { components } from '$lib/api/types';

	type ThemeSettings = components['schemas']['ThemeSettings'];

	let workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let organizationID = $derived(workspaceCtx.currentWorkspace?.organization_id ?? '');

	// Previews and selection follow the user's effective light or dark scheme;
	// the backend resolver takes only a concrete scheme.
	let systemDark = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const query = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = query.matches;
		const onChange = (event: MediaQueryListEvent) => (systemDark = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});
	let preferredMode = $derived(mode.current ?? 'system');
	let scheme: 'light' | 'dark' = $derived(
		preferredMode === 'dark' || (preferredMode === 'system' && systemDark) ? 'dark' : 'light'
	);

	const settings = createQuery(() => themeSettingsOptions(workspaceID));
	const available = createQuery(() => themeAvailableThemesOptions(workspaceID));

	// SAFETY: the settings query is typed by themeSettingsOptions against the generated contract.
	let settingsData = $derived(settings.data as ThemeSettings | undefined);
	let canManageOrganization = $derived(settingsData?.can_manage_organization ?? false);
	let canManageWorkspace = $derived(settingsData?.can_manage_workspace ?? false);

	const organizationThemes = createInfiniteQuery(() => ({
		...themeOrganizationThemesInfiniteOptions(workspaceID, organizationID),
		enabled: Boolean(workspaceID && organizationID && canManageOrganization)
	}));
	const drafts = $derived(
		(organizationThemes.data?.pages.flatMap((page) => page.items) ?? []).filter(
			(item) => !item.published_revision
		)
	);
	const draftPreviews = createQueries(() => ({
		queries: drafts.map((summary) =>
			themeOrganizationThemeOptions(workspaceID, organizationID, summary.reference.id)
		)
	}));

	const publishedThemes = $derived(
		(available.data?.items ?? []).filter(
			(summary) => summary.reference.kind === 'custom' && summary.published_revision
		)
	);
	const previews = createQueries(() => ({
		queries: publishedThemes.map((summary) =>
			themeAvailableThemeOptions(workspaceID, summary.reference.id, summary.published_revision!)
		)
	}));
	const libraryItems = $derived.by(() => {
		const items: ThemeLibraryItem[] = [];
		for (const [index, summary] of publishedThemes.entries()) {
			const preview = previews[index]?.data;
			if (!preview) continue;
			items.push({
				manifest: preview.manifest,
				reference: summary.reference,
				source: 'organization',
				state: 'published',
				hasDraftChanges: Boolean(
					summary.draft_revision &&
					summary.published_revision &&
					summary.draft_revision > summary.published_revision
				),
				assignedWorkspaces: summary.assigned_workspace_count
			});
		}
		for (const [index, summary] of drafts.entries()) {
			const draft = draftPreviews[index]?.data?.draft;
			if (!draft) continue;
			items.push({
				manifest: draft.manifest,
				reference: summary.reference,
				source: 'organization',
				state: 'draft'
			});
		}
		return items;
	});
	const failedPreviewCount = $derived(
		[...previews, ...draftPreviews].filter((preview) => preview.isError).length
	);

	let selectedReference = $derived(settingsData?.effective_selection ?? undefined);
	let workspaceReference = $derived(settingsData?.workspace_selection ?? undefined);
	let organizationDefaultReference = $derived(settingsData?.organization_default ?? undefined);
	let selectionLocked = $derived(settingsData?.assignments_locked ?? false);

	let pendingMutations = $state(0);
	let busy = $derived(!settingsData || pendingMutations > 0);

	async function runWrite(action: () => Promise<void>, failure: string) {
		const session = captureQueryMutationSession();
		const targetWorkspaceID = workspaceID;
		const targetOrganizationID = organizationID;
		const targetThemeID = editingThemeID;
		const affectedWorkspaces = new Set([
			targetWorkspaceID,
			...workspaceCtx.workspaces
				.filter((workspace) => workspace.organization_id === targetOrganizationID)
				.map((workspace) => workspace.id)
		]);
		pendingMutations += 1;
		try {
			await action();
			const invalidate = [...affectedWorkspaces].flatMap(
				(id) => themeMutationCachePlan(id, targetThemeID || undefined).invalidate
			);
			await reconcileQueryMutation(queryClient, session, {
				invalidate: invalidate.map((filter) => ({ ...filter, refetchType: 'none' }))
			});
			if (!queryMutationSessionIsCurrent(session)) return;
			// Refresh independent reads without extending the completed write's busy state.
			for (const filter of invalidate)
				void queryClient.refetchQueries({ ...filter, type: 'active' });
		} catch (cause) {
			throw cause instanceof Error ? cause : new Error(failure);
		} finally {
			pendingMutations -= 1;
		}
	}

	async function assignWorkspace(reference: ThemeReference | null) {
		const session = captureQueryMutationSession();
		const targetWorkspaceID = workspaceID;
		await runWrite(async () => {
			const { data, error } = await client.PUT('/theme-assignments/{workspace_id}', {
				params: { path: { workspace_id: targetWorkspaceID } },
				body: { reference }
			});
			if (error || !data) throw new Error(m.theme_library_workspace_change_failed());
			const queryKey = themeSettingsOptions(targetWorkspaceID).queryKey;
			await reconcileQueryMutation(queryClient, session, {
				cancel: [{ queryKey, exact: true }],
				reconcile: () => queryClient.setQueryData(queryKey, data)
			});
		}, m.theme_library_workspace_change_failed());
	}

	function onSelect(reference: ThemeReference) {
		return assignWorkspace(reference);
	}

	function onInherit() {
		return assignWorkspace(null);
	}

	async function updateOrganizationSettings(input: {
		defaultReference: ThemeReference;
		assignmentsLocked: boolean;
	}) {
		const session = captureQueryMutationSession();
		const targetOrganizationID = organizationID;
		const workspaceIDs = new Set([
			workspaceID,
			...workspaceCtx.workspaces
				.filter((workspace) => workspace.organization_id === targetOrganizationID)
				.map((workspace) => workspace.id)
		]);
		await runWrite(async () => {
			const { data, error } = await client.PUT('/theme-settings/organization', {
				body: {
					organization_id: targetOrganizationID,
					default_reference: input.defaultReference,
					assignments_locked: input.assignmentsLocked
				}
			});
			if (error || !data) throw new Error(m.theme_library_default_change_failed());
			const keys = [...workspaceIDs].map((id) => themeSettingsOptions(id).queryKey);
			await reconcileQueryMutation(queryClient, session, {
				cancel: keys.map((queryKey) => ({ queryKey, exact: true })),
				reconcile: () => {
					for (const queryKey of keys)
						queryClient.setQueryData<ThemeSettings>(queryKey, (current) => {
							if (!current) return current;
							const workspaceSelection = data.assignments_locked
								? undefined
								: current.workspace_selection;
							return {
								...current,
								organization_default: data.default_reference,
								assignments_locked: data.assignments_locked,
								workspace_selection: workspaceSelection,
								effective_selection: workspaceSelection ?? data.default_reference
							};
						});
				}
			});
		}, m.theme_library_default_change_failed());
	}

	function onSetDefault(reference: ThemeReference) {
		return updateOrganizationSettings({
			defaultReference: reference,
			assignmentsLocked: settingsData?.assignments_locked ?? false
		});
	}

	function onToggleLock(locked: boolean) {
		const fallback = settingsData?.organization_default;
		if (!fallback) return Promise.reject(new Error(m.theme_library_lock_failed()));
		return updateOrganizationSettings({ defaultReference: fallback, assignmentsLocked: locked });
	}

	async function onCreate(input: CreateThemeInput) {
		const session = captureQueryMutationSession();
		const targetWorkspaceID = workspaceID;
		let created: components['schemas']['Theme'] | undefined;
		await runWrite(
			() =>
				client
					.POST('/themes', {
						body: {
							organization_id: organizationID,
							name: input.name,
							...(input.source.kind === 'built_in'
								? { duplicate_built_in_id: input.source.id }
								: {
										manifest: libraryItems.find(
											(item) =>
												item.reference.kind === 'custom' && item.reference.id === input.source.id
										)?.manifest
									})
						}
					})
					.then((result) => {
						if (result.error || !result.data) throw new Error(m.theme_library_create_failed());
						created = result.data;
					}),
			m.theme_library_create_failed()
		);
		if (!created || !queryMutationSessionIsCurrent(session) || workspaceID !== targetWorkspaceID)
			return;
		queryClient.setQueryData(
			themeOrganizationThemeOptions(workspaceID, organizationID, created.summary.reference.id)
				.queryKey,
			created
		);
		onEdit(created.summary.reference.id);
	}

	async function onDelete(themeID: string) {
		await runWrite(
			() =>
				client
					.DELETE('/themes/{id}', {
						params: {
							path: { id: themeID },
							query: { organization_id: organizationID, confirm: true }
						}
					})
					.then((result) => {
						if (result.error) throw new Error(m.theme_library_delete_failed());
					}),
			m.theme_library_delete_failed()
		);
	}

	let editingThemeID = $state(page.url.searchParams.get('theme') ?? '');

	function onEdit(themeID: string) {
		const url = new URL(page.url.href);
		url.searchParams.set('tab', 'appearance');
		url.searchParams.set('theme', themeID);
		replaceState(url.href, {});
		editingThemeID = themeID;
	}

	function closeEditor() {
		const url = new URL(page.url.href);
		url.searchParams.delete('theme');
		replaceState(url.href, {});
		editingThemeID = '';
	}

	const editorDetail = createQuery(() =>
		themeOrganizationThemeOptions(workspaceID, organizationID, editingThemeID)
	);
	const editorRevisions = createQuery(() =>
		themeRevisionsOptions(workspaceID, organizationID, editingThemeID)
	);

	let detail = $derived(editorDetail.data);
	let draftManifest = $derived(detail?.draft?.manifest ?? null);
	let baselineManifest = $derived(detail?.latest_published?.manifest ?? null);
	let canPublish = $derived(canManageOrganization && Boolean(detail?.draft));
	let revisionItems = $derived.by(() => {
		const pageResult = editorRevisions.data;
		if (!pageResult) return [];
		return pageResult.items.map((revision) => ({
			revision: revision.revision,
			label: m.theme_editor_revision({ revision: revision.revision }),
			publishedAt: revision.published_at,
			current: detail?.summary.published_revision === revision.revision
		}));
	});

	async function saveDraft(manifest: ThemeManifest) {
		const session = captureQueryMutationSession();
		const targetWorkspaceID = workspaceID;
		const targetOrganizationID = organizationID;
		const current = detail;
		if (!current?.draft) throw new Error(m.theme_editor_draft_save_failed());
		const themeID = current.summary.reference.id;
		const { data, error } = await client.PUT('/themes/{id}/draft', {
			params: { path: { id: themeID } },
			body: {
				organization_id: targetOrganizationID,
				expected_revision: current.draft.revision,
				name: current.summary.name,
				manifest
			}
		});
		if (error || !data) throw new Error(m.theme_editor_draft_save_failed());
		const queryKey = themeOrganizationThemeOptions(
			targetWorkspaceID,
			targetOrganizationID,
			themeID
		).queryKey;
		await reconcileQueryMutation(queryClient, session, {
			cancel: [{ queryKey, exact: true }],
			reconcile: () => queryClient.setQueryData(queryKey, data)
		});
		return data;
	}

	async function onSave(manifest: ThemeManifest) {
		await runWrite(async () => {
			await saveDraft(manifest);
		}, m.theme_editor_draft_save_failed());
	}

	async function onPublish(manifest: ThemeManifest) {
		const targetWorkspaceID = workspaceID;
		const targetOrganizationID = organizationID;
		const session = captureQueryMutationSession();
		await runWrite(async () => {
			const saved = await saveDraft(manifest);
			if (!queryMutationSessionIsCurrent(session)) return;
			const themeID = saved.summary.reference.id;
			const { data, error } = await client.POST('/themes/{id}/publish', {
				params: { path: { id: themeID } },
				body: {
					organization_id: targetOrganizationID,
					expected_draft_revision: saved.draft?.revision ?? 0,
					expected_published_revision: saved.summary.published_revision ?? 0
				}
			});
			if (error || !data) throw new Error(m.theme_editor_publish_failed());
			const queryKey = themeOrganizationThemeOptions(
				targetWorkspaceID,
				targetOrganizationID,
				themeID
			).queryKey;
			await reconcileQueryMutation(queryClient, session, {
				cancel: [{ queryKey, exact: true }],
				reconcile: () =>
					queryClient.setQueryData(queryKey, {
						...saved,
						latest_published: data,
						summary: {
							...saved.summary,
							reference: { ...saved.summary.reference, version: data.revision },
							published_revision: data.revision
						}
					})
			});
		}, m.theme_editor_publish_failed());
	}

	async function onRollback(revision: number) {
		const session = captureQueryMutationSession();
		const targetWorkspaceID = workspaceID;
		const targetOrganizationID = organizationID;
		let rolledManifest: ThemeManifest | null = null;
		await runWrite(async () => {
			const current = detail;
			if (!current?.draft) throw new Error(m.theme_editor_restore_failed());
			const themeID = current.summary.reference.id;
			const { data, error } = await client.POST('/themes/{id}/rollback', {
				params: { path: { id: themeID } },
				body: {
					organization_id: organizationID,
					source_revision: revision,
					expected_draft_revision: current.draft?.revision ?? 0,
					expected_published_revision: current.summary.published_revision ?? 0
				}
			});
			if (error || !data) throw new Error(m.theme_editor_restore_failed());
			// Restore advances the published head and replaces the draft with its next revision.
			const draftRevision = current.draft.revision + 1;
			rolledManifest = { ...data.manifest, revision: `draft-${draftRevision}` };
			const restored: components['schemas']['Theme'] = {
				...current,
				latest_published: data,
				draft: {
					...current.draft,
					revision: draftRevision,
					manifest: rolledManifest,
					updated_by: data.published_by,
					updated_at: data.published_at
				},
				summary: {
					...current.summary,
					name: data.manifest.name,
					reference: { ...current.summary.reference, version: data.revision },
					published_revision: data.revision,
					draft_revision: draftRevision
				}
			};
			const queryKey = themeOrganizationThemeOptions(
				targetWorkspaceID,
				targetOrganizationID,
				themeID
			).queryKey;
			await reconcileQueryMutation(queryClient, session, {
				cancel: [{ queryKey, exact: true }],
				reconcile: () => queryClient.setQueryData(queryKey, restored)
			});
		}, m.theme_editor_restore_failed());
		if (!rolledManifest) throw new Error(m.theme_editor_restore_failed());
		return rolledManifest;
	}
</script>

{#if !settingsData && settings.isPending}
	<PageLoading layout="settings" label={m.common_loading()} />
{/if}

{#if settings.isError}
	<InlineNotice tone="error" message={m.workspace_settings_load_failed()}>
		{#snippet actions()}
			<Button intent="ordinary" onclick={() => void settings.refetch()}>{m.common_retry()}</Button>
		{/snippet}
	</InlineNotice>
{/if}
{#if available.isError || organizationThemes.isError}
	<InlineNotice tone="error" message={m.theme_library_open_failed()}>
		{#snippet actions()}
			<Button
				intent="ordinary"
				onclick={() => {
					void available.refetch();
					if (canManageOrganization) void organizationThemes.refetch();
				}}>{m.common_retry()}</Button
			>
		{/snippet}
	</InlineNotice>
{/if}

{#if editingThemeID && editorDetail.isPending}
	<PageLoading layout="settings" label={m.common_loading()} />
{/if}

{#if editingThemeID && detail && draftManifest}
	<ThemeEditor
		initialTheme={draftManifest}
		baselineTheme={baselineManifest ?? undefined}
		revisions={revisionItems}
		{canPublish}
		{busy}
		{onSave}
		onPublish={canPublish ? onPublish : undefined}
		onRollback={canPublish ? onRollback : undefined}
		onReload={() => {
			const manifest = detail?.draft?.manifest;
			if (!manifest) throw new Error(m.theme_editor_reload_failed());
			return manifest;
		}}
		onClose={closeEditor}
	/>
{:else if editingThemeID && editorDetail.isError}
	<InlineNotice tone="error" message={m.theme_library_open_failed()}>
		{#snippet actions()}
			<Button intent="ordinary" onclick={() => void editorDetail.refetch()}
				>{m.common_retry()}</Button
			>
			<Button intent="quiet" onclick={closeEditor}>{m.common_close()}</Button>
		{/snippet}
	</InlineNotice>
{/if}

{#if !editingThemeID && settingsData}
	{#if failedPreviewCount > 0}
		<InlineNotice tone="warning" message={m.theme_library_preview_failed()}>
			{#snippet actions()}
				<Button
					intent="ordinary"
					onclick={() => {
						for (const preview of [...previews, ...draftPreviews])
							if (preview.isError) void preview.refetch();
					}}>{m.common_retry()}</Button
				>
			{/snippet}
		</InlineNotice>
	{/if}
	{#key workspaceID}
		<ThemeLibrary
			organizationThemes={libraryItems}
			organizationThemesLoading={organizationThemes.isPending && canManageOrganization}
			onLoadMoreOrganizationThemes={organizationThemes.hasNextPage
				? () => {
						void organizationThemes.fetchNextPage();
					}
				: undefined}
			loadingMoreOrganizationThemes={organizationThemes.isFetchingNextPage}
			{selectedReference}
			{workspaceReference}
			{organizationDefaultReference}
			workspaceSelectionLocked={selectionLocked}
			{scheme}
			{canManageOrganization}
			{canManageWorkspace}
			{busy}
			onSelect={canManageWorkspace ? onSelect : undefined}
			onInherit={canManageWorkspace ? onInherit : undefined}
			onSetDefault={canManageOrganization ? onSetDefault : undefined}
			onCreate={canManageOrganization ? onCreate : undefined}
			onEdit={canManageOrganization ? onEdit : undefined}
			onDelete={canManageOrganization ? onDelete : undefined}
			onToggleLock={canManageOrganization ? onToggleLock : undefined}
			onSchemeChange={(nextScheme) => setMode(nextScheme)}
		/>
	{/key}
{/if}
