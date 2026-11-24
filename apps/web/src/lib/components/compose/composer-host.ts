import type { SocialAccount } from '$lib/api/client';
import type { components } from '$lib/api/types';
import type { MentionMetadata } from '@openpost/platform-text/mentions';
import type { ProviderReadinessDecision } from '$lib/provider-readiness';
import type { PostItem, VariantPost } from './draft-utils';
import type { ComposerPublicationPayload } from './modes';
import type { ComposerIssue } from './validation';
import type { ComposerSettings } from './modes';
import type { QueryMutationSession } from '$lib/query/authorization-boundary';

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
	readonly settingsByAccount: Record<string, ComposerSettings>;
	readonly segmentSettingsByPost: Record<string, Record<string, ComposerSettings>>;
	mediaSettingsByAccount: Record<string, Record<string, ComposerSettings>>;
	posts: PostItem[];
	activePostIndex: number;
	readonly isThread: boolean;
	variants: Map<string, Record<string, VariantPost>>;
	activeVariantAccountId: string | null;
	linkUrl: string;
	readonly composerMediaLimit: number;
	readonly hasPendingPasteMediaUploads: boolean;
	/** Changes whenever authored media or destination choices could change image preparation. */
	readonly imagePreparationContext: string;
	mediaPickerOpen: boolean;
	mediaPickerPostIndex: number;
	mediaPickerInitialFiles: File[];
	mediaPickerInitialMode: 'upload' | 'meme';
	readonly clearPickerMeme: () => void;
	readonly resolvedCapabilities: Record<string, ResolvedAccountCapabilityWithReadiness>;
	readonly getVariantContent: (accountId: string, postKey: string) => string | null;
	readonly getVariantPost: (accountId: string, postKey: string) => VariantPost | null;
	readonly getVariantMediaIds: (accountId: string, postKey: string) => string[] | null;
	readonly getEditorContentForPost: (post: PostItem) => string;
	readonly getEditorMediaIdsForPost: (post: PostItem) => string[];
	readonly setEditorMediaIds: (postIndex: number, mediaIds: string[]) => void;
	readonly mergeMediaIds: (current: string[], incoming: string[]) => string[];
	readonly settingsForAccount: (account: SocialAccount) => ComposerSettings;
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
