<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { getCurrentLocale, onLocaleChange } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import {
		BUILT_IN_THEMES,
		resolveBuiltInTheme,
		type ThemeManifest,
		type ThemeScheme,
		type WebResolvedTheme
	} from '$lib/themes';
	import ThemePreview from './theme-preview.svelte';
	import { themeCodePointLength } from './theme-editor-model';
	import {
		parseThemeExternalErrorMessage,
		themeBuiltInDescription,
		themeSchemeLabel
	} from './theme-editor-presenter';
	import ThemeLibraryBuiltins from './theme-library-builtins.svelte';
	import ThemeLibraryCreateDialog from './theme-library-create-dialog.svelte';
	import ThemeLibraryOrganizationList from './theme-library-organization-list.svelte';
	import {
		builtInManifestReference,
		sameThemeFamily,
		sameThemeReference,
		themeReferenceKey,
		WORKSHOP_REFERENCE,
		type ThemeReference
	} from './theme-library-model';
	import type { CreateThemeInput, ThemeLibraryItem } from './theme-library-types';

	const localBuiltInThemes: ThemeLibraryItem[] = BUILT_IN_THEMES.map((manifest) => ({
		manifest,
		reference: builtInManifestReference(manifest.id, manifest.revision),
		source: 'builtin',
		state: 'published'
	}));

	interface Props {
		builtInThemes?: ThemeLibraryItem[];
		organizationThemes?: ThemeLibraryItem[];
		selectedReference?: ThemeReference;
		workspaceReference?: ThemeReference;
		organizationDefaultReference?: ThemeReference;
		workspaceSelectionLocked?: boolean;
		scheme?: ThemeScheme;
		canManageOrganization?: boolean;
		canManageWorkspace?: boolean;
		busy?: boolean;
		previewResourceURL?: (resourceID: string, manifest: ThemeManifest) => string;
		onSelect?: (reference: ThemeReference) => void | Promise<void>;
		onInherit?: () => void | Promise<void>;
		onSetDefault?: (reference: ThemeReference) => void | Promise<void>;
		onCreate?: (input: CreateThemeInput) => void | Promise<void>;
		onEdit?: (themeID: string) => void | Promise<void>;
		onDelete?: (themeID: string) => void | Promise<void>;
		onToggleLock?: (locked: boolean) => void | Promise<void>;
	}

	let {
		builtInThemes = localBuiltInThemes,
		organizationThemes = [],
		selectedReference = WORKSHOP_REFERENCE,
		workspaceReference,
		organizationDefaultReference = WORKSHOP_REFERENCE,
		workspaceSelectionLocked = false,
		scheme = 'light',
		canManageOrganization = false,
		canManageWorkspace = false,
		busy = false,
		previewResourceURL,
		onSelect,
		onInherit,
		onSetDefault,
		onCreate,
		onEdit,
		onDelete,
		onToggleLock
	}: Props = $props();
	let deleteCandidate = $state<ThemeLibraryItem | null>(null);
	let deleteDialogOpen = $state(false);
	let lockDialogOpen = $state(false);
	let createDialogOpen = $state(false);
	let createName = $state('');
	let createSourceReference = $state<ThemeReference>(WORKSHOP_REFERENCE);
	let createError = $state('');
	let activeLocale = $state(untrack(getCurrentLocale));
	let previewReference = $state<ThemeReference>(untrack(() => selectedReference));
	let observedSelectedReferenceKey = $state(untrack(() => themeReferenceKey(selectedReference)));
	let actionError = $state('');
	let pendingAction = $state(false);

	const effectiveBuiltInThemes = $derived(
		builtInThemes.length > 0 ? builtInThemes : localBuiltInThemes
	);
	const allItems = $derived([...effectiveBuiltInThemes, ...organizationThemes]);
	const copySourceItems = $derived(allItems.filter((item) => item.state !== 'draft'));
	const workshopReference = $derived(
		effectiveBuiltInThemes.find((item) => item.manifest.id === 'workshop')?.reference ??
			WORKSHOP_REFERENCE
	);
	const activeItem = $derived(
		allItems.find((item) => sameThemeReference(item.reference, selectedReference)) ??
			effectiveBuiltInThemes[0]!
	);
	const selectedItem = $derived(
		allItems.find((item) => sameThemeReference(item.reference, previewReference)) ?? activeItem
	);
	const createSourceItem = $derived(
		copySourceItems.find((item) => sameThemeReference(item.reference, createSourceReference)) ??
			effectiveBuiltInThemes[0]!
	);
	const selectedPreview = $derived(resolvePreview(selectedItem, scheme));
	const selectedSchemeLabel = $derived(themeSchemeLabel(scheme, activeLocale));
	const selectedFallbackMessage = $derived(
		selectedPreview.fallbackReason === 'unsupported-scheme'
			? m.theme_library_preview_unsupported(
					{ name: selectedItem.manifest.name, scheme: selectedSchemeLabel },
					{ locale: activeLocale }
				)
			: selectedPreview.fallbackReason === 'unsafe-resource' ||
				  selectedPreview.fallbackReason === 'resource-failed'
				? m.theme_library_preview_unsafe(
						{ name: selectedItem.manifest.name, scheme: selectedSchemeLabel },
						{ locale: activeLocale }
					)
				: m.theme_library_preview_incomplete(
						{ name: selectedItem.manifest.name, scheme: selectedSchemeLabel },
						{ locale: activeLocale }
					)
	);
	const selectedCanAssign = $derived(selectedItem.state !== 'draft');
	const selectedIsOrganizationDefault = $derived(
		sameThemeReference(selectedItem.reference, organizationDefaultReference)
	);
	const selectedIsActive = $derived(sameThemeReference(selectedItem.reference, selectedReference));
	const workspaceInherits = $derived(workspaceReference === undefined);
	const assignmentActionVisible = $derived(
		selectedIsOrganizationDefault ? !workspaceInherits : !selectedIsActive || workspaceInherits
	);
	const assignmentActionAvailable = $derived(
		selectedIsOrganizationDefault ? Boolean(onInherit) : Boolean(onSelect)
	);
	const createNameValid = $derived(
		themeCodePointLength(createName.trim()) >= 1 && themeCodePointLength(createName.trim()) <= 80
	);
	const libraryBusy = $derived(busy || pendingAction);
	onMount(() => onLocaleChange((locale) => (activeLocale = locale)));
	const defaultName = $derived(
		allItems.find((item) => sameThemeReference(item.reference, organizationDefaultReference))
			?.manifest.name ?? m.theme_library_workshop({}, { locale: activeLocale })
	);

	$effect(() => {
		const nextKey = themeReferenceKey(selectedReference);
		if (nextKey === observedSelectedReferenceKey) return;
		observedSelectedReferenceKey = nextKey;
		previewReference = selectedReference;
	});

	function resolvePreview(item: ThemeLibraryItem, requestedScheme: ThemeScheme): WebResolvedTheme {
		if (item.source === 'builtin') return resolveBuiltInTheme(item.manifest.id, requestedScheme);
		const manifest = item.manifest.schemes[requestedScheme];
		if (!manifest) {
			return {
				...resolveBuiltInTheme('workshop', requestedScheme),
				source: 'fallback',
				fallbackReason: 'unsupported-scheme'
			};
		}
		if (
			!previewResourceURL &&
			[...item.manifest.fonts, ...item.manifest.assets].some((resource) =>
				resource.sourceUrl.startsWith('asset:')
			)
		) {
			return {
				...resolveBuiltInTheme('workshop', requestedScheme),
				source: 'fallback',
				fallbackReason: 'unsafe-resource'
			};
		}
		return {
			id: item.manifest.id,
			revision: item.manifest.revision,
			name: item.manifest.name,
			iconPack: item.manifest.iconPack,
			source: 'organization',
			requestedScheme,
			scheme: requestedScheme,
			manifest,
			fonts: item.manifest.fonts.map((font) => ({
				...font,
				sourceUrl: previewResourceURL?.(font.id, item.manifest) ?? font.sourceUrl
			})),
			assets: item.manifest.assets.map((asset) => ({
				...asset,
				sourceUrl: previewResourceURL?.(asset.id, item.manifest) ?? asset.sourceUrl
			})),
			...(previewResourceURL ? { webResourceScope: 'editor-preview' as const } : {})
		};
	}

	async function deleteTheme() {
		if (!deleteCandidate || !onDelete) {
			return { ok: false, message: m.theme_library_delete_unavailable() };
		}
		try {
			await onDelete(deleteCandidate.manifest.id);
			deleteDialogOpen = false;
			deleteCandidate = null;
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				message: parseThemeExternalErrorMessage(error, m.theme_library_delete_failed())
			};
		}
	}

	async function confirmLock() {
		if (!onToggleLock) {
			return { ok: false, message: m.theme_library_settings_unavailable() };
		}
		try {
			await onToggleLock(true);
			lockDialogOpen = false;
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				message: parseThemeExternalErrorMessage(error, m.theme_library_lock_failed())
			};
		}
	}

	function openCreateDialog(source: ThemeReference, suggestedName = '') {
		createSourceReference = source;
		createName = suggestedName;
		createError = '';
		createDialogOpen = true;
	}

	async function createTheme() {
		const name = createName.trim();
		if (!onCreate || pendingAction || !createNameValid) return;
		pendingAction = true;
		createError = '';
		actionError = '';
		try {
			await onCreate({ name, source: createSourceReference });
			createDialogOpen = false;
			createName = '';
		} catch (error) {
			createError = parseThemeExternalErrorMessage(error, m.theme_library_create_failed());
		} finally {
			pendingAction = false;
		}
	}

	async function runAction(action: (() => void | Promise<void>) | undefined, fallback: string) {
		if (!action || pendingAction) return;
		pendingAction = true;
		actionError = '';
		try {
			await action();
		} catch (error) {
			actionError = parseThemeExternalErrorMessage(error, fallback);
		} finally {
			pendingAction = false;
		}
	}
</script>

{#key activeLocale}
	<section
		class="space-y-8"
		aria-labelledby="theme-library-heading"
		aria-busy={libraryBusy}
		data-testid="theme-library"
	>
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="max-w-2xl">
				<h2 id="theme-library-heading" class="text-lg font-semibold tracking-tight">
					{m.theme_library_heading()}
				</h2>
				<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
					{m.theme_library_description()}
				</p>
			</div>
			{#if canManageOrganization}
				<Button
					intent="focal"
					onclick={() => openCreateDialog(workshopReference)}
					disabled={!onCreate || libraryBusy}>{m.theme_library_create_theme()}</Button
				>
			{/if}
		</div>

		{#if actionError}
			<div
				class="rounded-[var(--theme-radius-md,var(--radius))] border border-destructive/35 bg-destructive/8 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{actionError}
			</div>
		{/if}

		<div class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.65fr)]">
			<div class="min-w-0 space-y-3">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<h3 class="font-semibold">{selectedItem.manifest.name}</h3>
							<span
								class="rounded-[var(--theme-radius-pill,999px)] bg-muted px-2 py-0.5 text-xs text-muted-foreground"
								>{selectedItem.source === 'builtin'
									? m.theme_library_builtin()
									: selectedItem.hasDraftChanges
										? m.theme_library_draft_changes()
										: selectedItem.state === 'draft'
											? m.theme_library_draft()
											: m.theme_library_published()}</span
							>
						</div>
						<p class="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
							{selectedItem.reference.kind === 'built_in'
								? themeBuiltInDescription(selectedItem.manifest.id, activeLocale)
								: selectedItem.manifest.description}
						</p>
					</div>
					<span class="text-xs text-muted-foreground">
						{m.theme_editor_revision({ revision: selectedItem.manifest.revision })}
					</span>
				</div>
				<ThemePreview
					theme={selectedPreview}
					scene="dashboard"
					viewport="desktop"
					label={m.theme_library_dashboard_preview({ name: selectedPreview.name })}
					locale={activeLocale}
				/>
				{#if selectedPreview.fallbackReason}
					<p
						class="rounded-[var(--theme-radius-md,var(--radius))] border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-foreground"
						role="status"
					>
						{selectedFallbackMessage}
					</p>
				{/if}
			</div>
			<div
				class="flex flex-col divide-y divide-border rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card px-4"
			>
				<div class="py-4">
					<p class="text-xs font-medium text-muted-foreground">
						{m.theme_library_this_workspace()}
					</p>
					<div class="mt-1 flex items-center justify-between gap-3">
						<div>
							<p class="font-semibold">{activeItem.manifest.name}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{workspaceSelectionLocked || workspaceInherits
									? m.theme_library_set_by_organization({ name: defaultName })
									: m.theme_library_workspace_selection()}
							</p>
						</div>
						<span
							class="rounded-[var(--theme-radius-pill,999px)] bg-success/12 px-2 py-1 text-xs font-medium text-success"
						>
							{m.theme_library_active()}
						</span>
					</div>
				</div>

				<div class="py-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<p class="text-sm font-medium">{m.theme_library_organization_default()}</p>
							<p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
								{m.theme_library_new_workspaces_default({ name: defaultName })}
							</p>
						</div>
						{#if canManageOrganization && selectedCanAssign && !sameThemeReference(previewReference, organizationDefaultReference)}
							<Button
								size="sm"
								intent="ordinary"
								onclick={() =>
									void runAction(
										() => onSetDefault?.(previewReference),
										m.theme_library_default_change_failed()
									)}
								disabled={libraryBusy}
							>
								{m.theme_library_make_default()}
							</Button>
						{/if}
					</div>
				</div>

				<div class="py-4">
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-sm font-medium">{m.theme_library_lock_workspace()}</p>
							<p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
								{m.theme_library_lock_description()}
							</p>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={workspaceSelectionLocked}
							aria-label={m.theme_library_lock_label()}
							disabled={!canManageOrganization || libraryBusy}
							class="group relative h-11 w-14 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
							onclick={() => {
								if (workspaceSelectionLocked) {
									void runAction(() => onToggleLock?.(false), m.theme_library_unlock_failed());
									return;
								}
								lockDialogOpen = true;
							}}
						>
							<span
								class="absolute top-2 left-1 h-7 w-12 rounded-full border border-border bg-muted transition-colors group-aria-checked:bg-[var(--action-primary)]"
							>
								<span
									class="absolute top-1/2 left-1 size-5 -translate-y-1/2 rounded-full bg-background shadow-sm transition-transform group-aria-checked:translate-x-5"
								></span>
							</span>
						</button>
					</div>
				</div>

				<div class="flex flex-wrap gap-2 py-4">
					{#if assignmentActionVisible}
						<Button
							intent="focal"
							onclick={() =>
								void runAction(
									selectedIsOrganizationDefault ? onInherit : () => onSelect?.(previewReference),
									m.theme_library_workspace_change_failed()
								)}
							disabled={!selectedCanAssign ||
								!canManageWorkspace ||
								workspaceSelectionLocked ||
								!assignmentActionAvailable ||
								libraryBusy}
							aria-describedby={selectedItem.state === 'draft' || workspaceSelectionLocked
								? 'theme-assignment-disabled-reason'
								: undefined}
						>
							{selectedIsOrganizationDefault
								? m.theme_library_use_default()
								: m.theme_library_use_theme({ name: selectedItem.manifest.name })}
						</Button>
						{#if selectedItem.state === 'draft' || workspaceSelectionLocked}
							<p
								id="theme-assignment-disabled-reason"
								class="basis-full text-xs text-muted-foreground"
							>
								{selectedItem.state === 'draft'
									? m.theme_library_publish_before_assigning()
									: m.theme_library_selection_locked()}
							</p>
						{/if}
					{/if}
					<Button
						intent="ordinary"
						onclick={() =>
							openCreateDialog(
								previewReference,
								m.theme_library_copy_name({ name: selectedItem.manifest.name })
							)}
						disabled={!canManageOrganization || !onCreate || libraryBusy}
					>
						{m.theme_library_duplicate()}
					</Button>
					{#if selectedItem.source === 'organization'}
						<Button
							intent="quiet"
							onclick={() =>
								void runAction(() => onEdit?.(previewReference.id), m.theme_library_open_failed())}
							disabled={!canManageOrganization || libraryBusy}
						>
							{m.theme_library_edit_theme()}
						</Button>
					{/if}
				</div>
			</div>
		</div>

		<ThemeLibraryBuiltins
			items={effectiveBuiltInThemes}
			{selectedReference}
			{previewReference}
			{organizationDefaultReference}
			{scheme}
			locale={activeLocale}
			busy={libraryBusy}
			onPreview={(reference) => (previewReference = reference)}
		/>

		<ThemeLibraryOrganizationList
			items={organizationThemes}
			{organizationDefaultReference}
			canManage={canManageOrganization}
			busy={libraryBusy}
			canCreate={Boolean(onCreate)}
			onNew={() => openCreateDialog(workshopReference)}
			onStartWithWorkshop={() =>
				openCreateDialog(workshopReference, m.theme_library_workshop_copy())}
			onPreview={(reference) => (previewReference = reference)}
			onEdit={(themeID) => void runAction(() => onEdit?.(themeID), m.theme_library_open_failed())}
			onDeleteRequest={(item) => {
				deleteCandidate = item;
				deleteDialogOpen = true;
			}}
		/>
	</section>

	<ThemeLibraryCreateDialog
		bind:open={createDialogOpen}
		bind:name={createName}
		bind:source={createSourceReference}
		sourceItem={createSourceItem}
		items={copySourceItems}
		busy={pendingAction}
		error={createError}
		valid={createNameValid}
		onSubmit={() => void createTheme()}
	/>

	<DestructiveConfirmDialog
		bind:open={deleteDialogOpen}
		title={deleteCandidate
			? m.theme_library_delete_title({ name: deleteCandidate.manifest.name })
			: m.theme_library_delete_fallback_title()}
		description={m.theme_library_delete_description()}
		confirmLabel={m.theme_library_delete_theme()}
		onConfirm={deleteTheme}
	/>

	<DestructiveConfirmDialog
		bind:open={lockDialogOpen}
		title={m.theme_library_lock_title()}
		description={m.theme_library_lock_confirm_description()}
		confirmLabel={m.theme_library_lock_confirm()}
		onConfirm={confirmLock}
	/>
{/key}
