import type { SocialAccount } from '$lib/api/client';
import type { components } from '$lib/api/types';
import type { MentionMetadata } from '@openpost/platform-text/mentions';
import type { ProviderReadinessDecision } from '$lib/provider-readiness';
import type { PostItem, VariantPost } from './draft-utils';
import type { ComposerPublicationPayload } from './modes';
import type { ComposerIssue } from './validation';

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
	readonly selectedWorkspaceId: string;
	posts: PostItem[];
	variants: Map<string, Record<string, VariantPost>>;
	readonly activeVariantAccountId: string | null;
	readonly selectedAccounts: SocialAccount[];
	readonly resolvedCapabilities: Record<string, ResolvedAccountCapabilityWithReadiness>;
	readonly getVariantContent: (accountId: string, postKey: string) => string | null;
	readonly getVariantPost: (accountId: string, postKey: string) => VariantPost | null;
	readonly handleVariantChange: (
		accountId: string,
		index: number,
		value: string,
		mentions?: MentionMetadata
	) => void;
	readonly setPostContent: (index: number, value: string, mentions?: MentionMetadata) => void;
	readonly composerIssuePostIndex: (issue: ComposerIssue) => number;
	readonly scheduleAutoSave: () => void;
}
