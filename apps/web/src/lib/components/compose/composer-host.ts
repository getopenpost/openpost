import type { SocialAccount } from '$lib/api/client';
import type { components } from '$lib/api/types';
import type { MentionMetadata } from '@openpost/platform-text/mentions';
import type { ProviderReadinessDecision } from '$lib/provider-readiness';
import type { PostItem, VariantPost } from './draft-utils';
import type { ComposerModeKey, ComposerPublicationPayload, ComposerSettings } from './modes';
import type { ComposerIssue } from './validation';
import type { resolvePollPreview } from './polls';
import type { AttachmentRequirement } from './ai-build-metadata';
import type { QueryMutationSession } from '$lib/query/authorization-boundary';
import type { ComposerHandoffPayload } from '$lib/composer/handoff-payload';
import type { ComposerSession } from '$lib/composer/session';
import type { ComposerRecoverySnapshot } from '$lib/editor-handoff';

export type Publication = components['schemas']['PublicationResponse'];
export type SocialSet = components['schemas']['SocialSetResponse'];
export type Capability = components['schemas']['Capability'];
export type SettingDefinition = components['schemas']['SettingDefinition'];
type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
export type ResolvedAccountCapabilityWithReadiness = ResolvedAccountCapability & {
	immediate_readiness?: ProviderReadinessDecision;
	scheduled_readiness?: ProviderReadinessDecision;
};
export type DestinationOption = components['schemas']['DestinationOption'];
export type ValidationIssue = components['schemas']['ValidationIssue'];
export type DeliveryOutcome = components['schemas']['RenditionActionOutcome'];
export type ComposerRenditionSegment = NonNullable<
	NonNullable<ComposerPublicationPayload['renditions']>[number]['segments']
>[number];
export type ProviderSettingValue = SettingDefinition['default'];
export type ProviderSettings = NonNullable<components['schemas']['RenditionInput']['settings']>;

/**
 * The composer's authored state and actions, as `compose-text-post.svelte` exposes them to the
 * domain controllers it owns. The component remains the single owner of this state; controllers
 * read and write it through these accessors and never keep a parallel copy.
 */
export interface ComposerHost {
	readonly composerDestroyed: boolean;
	/** The current page URL, read from the SvelteKit page store at call time. */
	readonly pageURL: URL;
	readonly selectedWorkspaceId: string;
	readonly publicationId: string;
	readonly isSubmitting: boolean;
	error: string;
	validationIssues: ValidationIssue[];
	/** Increments when pending saves must no longer apply their results. */
	readonly saveGeneration: number;
	readonly accounts: SocialAccount[];
	selectedAccountIds: string[];
	readonly selectedAccounts: SocialAccount[];
	selectedSocialSetId: string;
	requestedOutputProfiles: Record<string, string>;
	formatLockedByAccount: Record<string, boolean>;
	settingsByAccount: Record<string, ComposerSettings>;
	scheduleOverridesByAccount: Record<string, string>;
	captionMentionsByAccount: Record<
		string,
		{ field: string; body: string; mentions: MentionMetadata } | null
	>;
	readonly segmentSettingsByPost: Record<string, Record<string, ComposerSettings>>;
	mediaSettingsByAccount: Record<string, Record<string, ComposerSettings>>;
	posts: PostItem[];
	readonly activePost: PostItem;
	activePostIndex: number;
	readonly isThread: boolean;
	readonly textComposerMode: ComposerModeKey;
	variants: Map<string, Record<string, VariantPost>>;
	activeVariantAccountId: string | null;
	linkUrl: string;
	readonly composerMediaLimit: number;
	readonly mediaAltTexts: Map<string, string>;
	readonly attachmentRequirements: Record<string, AttachmentRequirement>;
	readonly hasPendingPasteMediaUploads: boolean;
	readonly pasteMediaUploadBlocker: () => string;
	/** Changes whenever authored media or destination choices could change image preparation. */
	readonly imagePreparationContext: string;
	mediaPickerOpen: boolean;
	mediaPickerPostIndex: number;
	mediaPickerInitialFiles: File[];
	mediaPickerInitialMode: 'upload' | 'meme';
	readonly clearPickerMeme: () => void;
	readonly settingsAccount: SocialAccount | null;
	settingsAccountId: string;
	settingsDialogOpen: boolean;
	readonly resolvedCapabilities: Record<string, ResolvedAccountCapabilityWithReadiness>;
	readonly getVariantContent: (accountId: string, postKey: string) => string | null;
	readonly getVariantPost: (accountId: string, postKey: string) => VariantPost | null;
	readonly getVariantMediaIds: (accountId: string, postKey: string) => string[] | null;
	readonly getEditorContentForPost: (post: PostItem) => string;
	readonly getEditorMediaIdsForPost: (post: PostItem) => string[];
	readonly setEditorMediaIds: (postIndex: number, mediaIds: string[]) => void;
	readonly mergeMediaIds: (current: string[], incoming: string[]) => string[];
	readonly settingsForAccount: (account: SocialAccount) => ComposerSettings;
	readonly destinationSettingsForAccount: (account: SocialAccount) => ComposerSettings;
	readonly joinedDescriptionKey: (account: SocialAccount) => string | undefined;
	readonly pollProjection: (
		post: PostItem,
		account: SocialAccount
	) => ReturnType<typeof resolvePollPreview>;
	readonly accountNeedsOwnSegmentCopy: (accountID: string) => boolean;
	readonly refreshSavedTextCardPreviews: () => void;
	readonly mediaAltTextForAccount: (mediaId: string, accountId: string) => string;
	readonly visibleSettings: (account: SocialAccount, post?: PostItem) => SettingDefinition[];
	readonly updateAccountSetting: (
		account: SocialAccount,
		key: string,
		value: ProviderSettingValue
	) => void;
	readonly saveMutationViewIsCurrent: (
		session: QueryMutationSession,
		generation: number,
		workspaceId: string
	) => boolean;
	readonly handleVariantChange: (
		accountId: string,
		index: number,
		value: string,
		mentions?: MentionMetadata
	) => void;
	readonly setPostContent: (index: number, value: string, mentions?: MentionMetadata) => void;
	readonly composerIssuePostIndex: (issue: ComposerIssue) => number;
	readonly accountContextLabel: (account: SocialAccount) => string;
	readonly prepareNewImageIds: (ids: string[], workspaceId: string) => Promise<string[] | null>;
	readonly hydrateMediaMetadata: (
		workspaceId: string,
		mediaIds: string[],
		force?: boolean
	) => Promise<void>;
	readonly generateMissingMediaAltText: (mediaIds: string[], postContext: string) => Promise<void>;
	readonly sessionFor: (
		workspaceId: string,
		existingPublicationId?: string
	) => Promise<ComposerSession>;
	readonly canonicalPublicationForHandoff: () => Promise<Publication | null>;
	readonly composerHandoffPayload: () => ComposerHandoffPayload;
	readonly restoreComposerHandoff: (
		snapshot: ComposerRecoverySnapshot,
		returnToken: string
	) => Promise<ComposerHandoffPayload>;
	readonly saveDraft: (options?: {
		saveAsCopy?: boolean;
		scheduledAt?: string | null;
		allowEmpty?: boolean;
	}) => Promise<string | null>;
	readonly scheduleAutoSave: () => void;
	readonly resolveCapabilities: () => Promise<void>;
	readonly scheduleCapabilityResolve: () => void;
	readonly startFirstComposition: (signal: 'text' | 'media' | 'content_mode') => Promise<void>;
}
