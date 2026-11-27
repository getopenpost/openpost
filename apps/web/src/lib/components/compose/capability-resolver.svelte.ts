import {
	type ResolvedAccountCapabilityWithReadiness,
	type DestinationOption
} from './composer-host';
import { SvelteSet } from 'svelte/reactivity';
import {
	hasUsableCapabilities,
	capabilityResponseApplies,
	capabilityResolutionIsFresh
} from './capability-readiness';
import { getLocaleRegion, getLocaleTag } from '$lib/i18n';
import { client, type SocialAccount } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import { loadableDestinationOptionSources, mergeDestinationOptions } from './destination-options';
import { publishingOptionsQueryOptions } from '@openpost/query-catalog';
import { schedulingQueryAPI } from '$lib/query/scheduling';
import { queryClient } from '$lib/query/client';
import type { ComposerHost } from './composer-host';

type CapabilityResolverHost = Pick<
	ComposerHost,
	| 'selectedWorkspaceId'
	| 'validationIssues'
	| 'selectedAccountIds'
	| 'selectedAccounts'
	| 'textComposerMode'
	| 'requestedOutputProfiles'
	| 'linkUrl'
	| 'posts'
	| 'variants'
	| 'settingsByAccount'
	| 'captionMentionsByAccount'
	| 'segmentSettingsByPost'
	| 'mediaSettingsByAccount'
	| 'attachmentRequirements'
	| 'mediaAltTexts'
	| 'mediaAltTextForAccount'
	| 'settingsAccountId'
	| 'settingsDialogOpen'
	| 'settingsForAccount'
	| 'visibleSettings'
	| 'destinationSettingsForAccount'
	| 'pollProjection'
	| 'getVariantMediaIds'
	| 'accountNeedsOwnSegmentCopy'
	| 'refreshSavedTextCardPreviews'
>;

/**
 * Resolves each selected destination's capabilities, limits, and readiness for the current
 * authored state, and loads provider destination options (boards, playlists, channels) on demand.
 * Resolves are debounced; content edits keep the last answer usable until structure changes.
 */
export class ComposerCapabilityResolver {
	private readonly host: CapabilityResolverHost;

	resolvedCapabilities = $state<Record<string, ResolvedAccountCapabilityWithReadiness>>({});

	private capabilityResolveLoading = $state(false);

	capabilityResolveError = $state('');

	destinationOptionsByAccount = $state<Record<string, Record<string, DestinationOption[]>>>({});

	destinationOptionCursorsByAccount = $state<Record<string, Record<string, string>>>({});

	destinationOptionSearchByAccount = $state<Record<string, Record<string, string>>>({});

	destinationOptionsErrors = $state<Record<string, string>>({});

	readonly destinationOptionsLoadingAccountIds = new SvelteSet<string>();

	private readonly destinationOptionsLoadingCounts = new Map<string, number>();

	private capabilityResolveTimer: ReturnType<typeof setTimeout> | null = null;

	private capabilityResolveAbortController: AbortController | null = null;

	lastResolvedCapabilityInputSnapshot = $state('');

	private lastResolvedCapabilityStructureSnapshot = $state('');

	private readonly destinationOptionsRequestSequences = new Map<string, number>();

	private capabilityResolveRequestSequence = 0;

	readonly capabilityInputSnapshot = $derived.by(() =>
		JSON.stringify({
			workspace: this.host.selectedWorkspaceId,
			variants: Array.from(this.host.variants.entries()),
			mediaAltTexts: Array.from(this.host.mediaAltTexts.entries()),
			accounts: this.host.selectedAccountIds,
			mode: this.host.textComposerMode,
			requestedOutputProfiles: this.host.requestedOutputProfiles,
			linkUrl: this.host.linkUrl,
			posts: this.host.posts.map((post) => ({
				key: post.key,
				content: post.content,
				mentions: post.mentions,
				mediaIds: post.mediaIds,
				poll: post.poll,
				link: post.link
			})),
			settingsByAccount: this.host.settingsByAccount,
			captionMentionsByAccount: this.host.captionMentionsByAccount,
			segmentSettingsByPost: this.host.segmentSettingsByPost,
			mediaSettingsByAccount: this.host.mediaSettingsByAccount,
			attachmentRequirements: this.host.attachmentRequirements
		})
	);

	readonly capabilityReadinessCurrent = $derived.by(
		() =>
			!this.capabilityResolveLoading &&
			this.lastResolvedCapabilityInputSnapshot === this.capabilityInputSnapshot &&
			this.host.selectedAccountIds.every((accountID) =>
				Boolean(this.resolvedCapabilities[accountID])
			)
	);

	// Content edits keep the previous answer usable. Structural edits (accounts,
	// formats, media shape, destination settings) must wait for the next answer.
	private readonly capabilityStructureSnapshot = $derived.by(() =>
		JSON.stringify({
			workspace: this.host.selectedWorkspaceId,
			accounts: this.host.selectedAccountIds,
			mode: this.host.textComposerMode,
			requestedOutputProfiles: this.host.requestedOutputProfiles,
			posts: this.host.posts.map((post) => ({ mediaIds: post.mediaIds, poll: Boolean(post.poll) })),
			variants: Array.from(this.host.variants.entries()).map(([accountID, values]) => [
				accountID,
				Object.fromEntries(
					Object.entries(values).map(([key, value]) => [
						key,
						{ mediaIds: value.mediaIds, contentInherited: value.contentInherited }
					])
				)
			]),
			settingsByAccount: this.host.settingsByAccount,
			segmentSettingsByPost: this.host.segmentSettingsByPost,
			attachmentRequirements: this.host.attachmentRequirements
		})
	);

	readonly capabilityReadinessKnown = $derived.by(
		() =>
			hasUsableCapabilities(
				this.host.selectedAccountIds,
				this.resolvedCapabilities,
				this.capabilityResolveError
			) && this.lastResolvedCapabilityStructureSnapshot === this.capabilityStructureSnapshot
	);

	scheduleCapabilityResolve = () => {
		if (this.capabilityResolveTimer) clearTimeout(this.capabilityResolveTimer);
		// Let the in-flight resolve finish so its provider work can populate the
		// cache. The next request aborts it only once the debounce elapses.
		this.capabilityResolveTimer = setTimeout(() => {
			this.capabilityResolveTimer = null;
			void this.resolveCapabilities();
		}, 300);
	};

	resolveCapabilities = async () => {
		if (this.capabilityResolveTimer) {
			clearTimeout(this.capabilityResolveTimer);
			this.capabilityResolveTimer = null;
		}
		const inputSnapshot = this.capabilityInputSnapshot;
		if (!this.host.selectedWorkspaceId || this.host.selectedAccountIds.length === 0) {
			this.capabilityResolveAbortController?.abort();
			this.capabilityResolveAbortController = null;
			this.capabilityResolveRequestSequence++;
			this.capabilityResolveLoading = false;
			this.resolvedCapabilities = {};
			this.host.validationIssues = [];
			this.capabilityResolveError = '';
			this.lastResolvedCapabilityInputSnapshot = inputSnapshot;
			this.lastResolvedCapabilityStructureSnapshot = this.capabilityStructureSnapshot;
			return;
		}
		this.capabilityResolveAbortController?.abort();
		const abortController = new AbortController();
		this.capabilityResolveAbortController = abortController;
		const requestSequence = ++this.capabilityResolveRequestSequence;
		this.capabilityResolveLoading = true;
		const region = getLocaleRegion();
		try {
			const { data, error: resolveError } = await client.POST('/capabilities/resolve', {
				signal: abortController.signal,
				body: {
					account_ids: this.host.selectedAccountIds,
					creation_preset: this.host.textComposerMode,
					requested_output_profiles: Object.fromEntries(
						this.host.selectedAccountIds
							.filter((accountId) => Boolean(this.host.requestedOutputProfiles[accountId]))
							.map((accountId) => [accountId, this.host.requestedOutputProfiles[accountId]])
					),
					source_url: this.host.linkUrl,
					locale: getLocaleTag(),
					region,
					account_settings: Object.fromEntries(
						this.host.selectedAccounts.map((account) => [
							account.id,
							this.host.destinationSettingsForAccount(account)
						])
					),
					account_segments: Object.fromEntries(
						this.host.selectedAccounts
							.filter((account) => this.host.accountNeedsOwnSegmentCopy(account.id))
							.map((account) => [
								account.id,
								this.host.posts.map((post) => ({
									id: post.key,
									content: this.host.pollProjection(post, account).body,
									url: post === this.host.posts[0] ? this.host.linkUrl : '',
									settings:
										post === this.host.posts[0] && this.host.attachmentRequirements[account.id]
											? { attachment_requirement: this.host.attachmentRequirements[account.id] }
											: undefined,
									media: (this.host.getVariantMediaIds(account.id, post.key) ?? post.mediaIds).map(
										(mediaId) => ({
											media_id: mediaId,
											alt_text: this.host.mediaAltTextForAccount(mediaId, account.id)
										})
									)
								}))
							])
					),
					segments: this.host.posts.map((post) => ({
						id: post.key,
						content: post.content,
						url: post === this.host.posts[0] ? this.host.linkUrl : '',
						media: post.mediaIds.map((mediaID) => ({
							media_id: mediaID,
							alt_text: this.host.mediaAltTexts.get(mediaID) ?? ''
						}))
					}))
				}
			});
			if (resolveError) {
				throw new Error(resolveError.detail || m.compose_load_capabilities_failed());
			}
			if (
				!capabilityResponseApplies({
					requestSequence,
					currentRequestSequence: this.capabilityResolveRequestSequence,
					requestedSnapshot: inputSnapshot,
					currentSnapshot: this.capabilityInputSnapshot
				})
			)
				return;
			this.capabilityResolveError = '';
			const resolvedAccounts = data?.accounts ?? [];
			this.resolvedCapabilities = Object.fromEntries(
				resolvedAccounts.map((capability) => [capability.account_id, capability])
			);
			for (const capability of resolvedAccounts) {
				const dynamic = capability.dynamic_options ?? {};
				if (Object.keys(dynamic).length === 0) continue;
				this.destinationOptionsByAccount = {
					...this.destinationOptionsByAccount,
					[capability.account_id]: {
						...(this.destinationOptionsByAccount[capability.account_id] ?? {}),
						...Object.fromEntries(
							Object.entries(dynamic).map(([source, options]) => [
								source,
								(options ?? []).map((option) => ({
									value: option.value,
									label: option.label
								}))
							])
						)
					}
				};
			}
			this.host.validationIssues = resolvedAccounts.flatMap(
				(capability) => capability.issues ?? []
			);
			this.lastResolvedCapabilityInputSnapshot = inputSnapshot;
			this.lastResolvedCapabilityStructureSnapshot = this.capabilityStructureSnapshot;
			this.host.refreshSavedTextCardPreviews();
			void this.loadRequiredDestinationOptions();
		} catch (resolveError) {
			if (abortController.signal.aborted) return;
			if (requestSequence !== this.capabilityResolveRequestSequence) return;
			this.capabilityResolveError =
				resolveError instanceof Error ? resolveError.message : m.compose_load_capabilities_failed();
		} finally {
			if (this.capabilityResolveAbortController === abortController) {
				this.capabilityResolveAbortController = null;
			}
			if (requestSequence === this.capabilityResolveRequestSequence) {
				this.capabilityResolveLoading = false;
			}
		}
	};

	resolveCapabilitiesCurrent = async (): Promise<boolean> => {
		// Edits can land while a request is in flight. Resolve again so a submit
		// decision never relies on an answer for a superseded state.
		for (let attempt = 0; attempt < 3; attempt++) {
			await this.resolveCapabilities();
			if (
				capabilityResolutionIsFresh(
					this.lastResolvedCapabilityInputSnapshot,
					this.capabilityInputSnapshot,
					this.capabilityResolveError
				)
			) {
				return true;
			}
			if (this.capabilityResolveError) return false;
		}
		return false;
	};

	private loadRequiredDestinationOptions = async () => {
		const accountsWithSources = this.host.selectedAccounts
			.map((account) => ({
				account,
				sources: this.host
					.visibleSettings(account)
					.filter((setting) => setting.required && Boolean(setting.options_source))
					.map((setting) => setting.options_source!)
					.filter((source) => this.destinationOptionsByAccount[account.id]?.[source] === undefined)
			}))
			.filter(({ sources }) => sources.length > 0);
		// Accounts are independent, but a large composer should not open one
		// provider request per destination at once.
		const queue = [...accountsWithSources];
		const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
			for (;;) {
				const next = queue.shift();
				if (!next) return;
				for (const source of new Set(next.sources)) {
					await this.loadDestinationOptions(next.account, false, source);
				}
			}
		});
		await Promise.allSettled(workers);
	};

	openDestinationSettings = (account: SocialAccount) => {
		this.host.settingsByAccount = {
			...this.host.settingsByAccount,
			[account.id]: this.host.settingsForAccount(account)
		};
		this.host.settingsAccountId = account.id;
		this.host.settingsDialogOpen = true;
		void this.loadDestinationOptions(account);
	};

	loadDestinationOptions = async (
		account: SocialAccount,
		force = false,
		onlySource = '',
		search = '',
		append = false
	) => {
		let sources = loadableDestinationOptionSources(
			this.host.visibleSettings(account),
			onlySource,
			this.host.settingsForAccount(account)
		);
		const requestWorkspaceId = this.host.selectedWorkspaceId;
		if (!force && !search) {
			sources = sources.filter(
				(source) => this.destinationOptionsByAccount[account.id]?.[source] === undefined
			);
		}
		if (sources.length === 0) return;
		const requestSequences = new Map<string, number>();
		for (const source of sources) {
			const key = this.destinationOptionsSequenceKey(account.id, source);
			const sequence = (this.destinationOptionsRequestSequences.get(key) ?? 0) + 1;
			this.destinationOptionsRequestSequences.set(key, sequence);
			requestSequences.set(source, sequence);
		}
		this.markDestinationOptionsLoading(account.id, 1);
		this.destinationOptionsErrors = { ...this.destinationOptionsErrors, [account.id]: '' };
		const region = getLocaleRegion();
		const accountSearches = this.destinationOptionSearchByAccount[account.id] ?? {};
		const effectiveSearch = onlySource && append ? (accountSearches[onlySource] ?? '') : search;
		if (onlySource && !append) {
			this.destinationOptionSearchByAccount = {
				...this.destinationOptionSearchByAccount,
				[account.id]: { ...accountSearches, [onlySource]: search }
			};
		}
		try {
			const results = await Promise.all(
				sources.map(async (source) => {
					const options = publishingOptionsQueryOptions(
						schedulingQueryAPI,
						this.host.selectedWorkspaceId,
						{
							accountId: account.id,
							source,
							region,
							locale: getLocaleTag(),
							limit: 25,
							search: effectiveSearch,
							cursor: append
								? (this.destinationOptionCursorsByAccount[account.id]?.[source] ?? '')
								: '',
							context: JSON.stringify(this.host.settingsForAccount(account))
						}
					);
					if (force && !onlySource && !search && !append) {
						await queryClient.invalidateQueries({
							queryKey: options.queryKey,
							exact: true,
							refetchType: 'none'
						});
					}
					const data = await queryClient.query(options);
					return [source, data?.options ?? [], data?.next_cursor ?? ''] as const;
				})
			);
			const applied = results.filter(
				([source]) =>
					this.destinationOptionsRequestSequences.get(
						this.destinationOptionsSequenceKey(account.id, source)
					) === requestSequences.get(source)
			);
			if (applied.length === 0) return;
			this.destinationOptionsByAccount = {
				...this.destinationOptionsByAccount,
				[account.id]: {
					...(this.destinationOptionsByAccount[account.id] ?? {}),
					...Object.fromEntries(
						applied.map(([source, options]) => [
							source,
							append
								? mergeDestinationOptions(
										this.destinationOptionsByAccount[account.id]?.[source] ?? [],
										options
									)
								: options
						])
					)
				}
			};
			this.destinationOptionCursorsByAccount = {
				...this.destinationOptionCursorsByAccount,
				[account.id]: {
					...(this.destinationOptionCursorsByAccount[account.id] ?? {}),
					...Object.fromEntries(applied.map(([source, , cursor]) => [source, cursor]))
				}
			};
		} catch (optionsError) {
			const current = sources.some(
				(source) =>
					this.destinationOptionsRequestSequences.get(
						this.destinationOptionsSequenceKey(account.id, source)
					) === requestSequences.get(source)
			);
			if (!current) return;
			this.destinationOptionsErrors = {
				...this.destinationOptionsErrors,
				[account.id]:
					optionsError instanceof Error
						? optionsError.message
						: m.compose_load_provider_options_failed()
			};
		} finally {
			if (requestWorkspaceId === this.host.selectedWorkspaceId) {
				this.markDestinationOptionsLoading(account.id, -1);
			}
		}
	};

	private destinationOptionsSequenceKey = (accountID: string, source: string): string => {
		return `${accountID}\u001f${source}`;
	};

	private markDestinationOptionsLoading = (accountID: string, delta: 1 | -1) => {
		const next = (this.destinationOptionsLoadingCounts.get(accountID) ?? 0) + delta;
		if (next > 0) {
			this.destinationOptionsLoadingCounts.set(accountID, next);
			this.destinationOptionsLoadingAccountIds.add(accountID);
			return;
		}
		this.destinationOptionsLoadingCounts.delete(accountID);
		this.destinationOptionsLoadingAccountIds.delete(accountID);
	};

	/** Stops results of in-flight capability resolves from applying. */
	invalidate = () => {
		this.capabilityResolveRequestSequence++;
	};

	/** Clears resolved answers and destination options that belong to the previous Workspace. */
	resetForWorkspaceChange = () => {
		this.resolvedCapabilities = {};
		this.destinationOptionsByAccount = {};
		this.destinationOptionCursorsByAccount = {};
		this.destinationOptionSearchByAccount = {};
		this.destinationOptionsErrors = {};
		this.destinationOptionsRequestSequences.clear();
		this.destinationOptionsLoadingCounts.clear();
		this.destinationOptionsLoadingAccountIds.clear();
		this.lastResolvedCapabilityInputSnapshot = '';
		this.lastResolvedCapabilityStructureSnapshot = '';
		this.capabilityResolveError = '';
	};

	/** Cancels the pending debounce and request when the composer unmounts. */
	dispose = () => {
		if (this.capabilityResolveTimer) clearTimeout(this.capabilityResolveTimer);
		this.capabilityResolveAbortController?.abort();
	};

	constructor(host: CapabilityResolverHost) {
		this.host = host;
	}
}
