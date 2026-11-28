import { z } from 'zod';
import { type PostItem, type VariantPost, normalizeVariantRecord } from './draft-utils';
import {
	type AIWorkspaceEntry,
	type AIWorkspaceStep,
	type AIWorkspaceDialogCopy,
	type AIOpportunity,
	type AIAngle,
	type AIGenerationPhase
} from '$lib/components/post-builder/ai-workspace-types';
import {
	type PublicationPostOption,
	type PublicationOpportunity,
	type PublicationBuildAngle,
	type PublicationBuild,
	type PublicationBuildResult,
	type PublicationBuildRequest,
	discoverPublicationOpportunities,
	planPublicationAngles,
	createPublicationBuild,
	getPublicationBuild,
	cancelPublicationBuild,
	retryPublicationBuild
} from '$lib/post-builder/client';
import { m } from '$lib/paraglide/messages';
import {
	type AIMemeRecommendationCandidate,
	type AIMemeRecommendationCopy
} from '$lib/components/post-builder/ai-meme-recommendation';
import { type MemeSuggestionCandidate } from '$lib/meme-generator/types';
import { type RepurposeHandoff } from '$lib/stores/ui.svelte';
import { composerBuildFingerprint } from '$lib/post-builder/composer-state';
import { getPlatformKey, getPlatformName } from '$lib/utils';
import { queryVoiceProfiles } from '$lib/query/voice-profiles';
import { ideate } from '$lib/post-builder/ideate.svelte';
import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
import { savePostVisual } from '$lib/post-builder/visuals';
import { SvelteMap } from 'svelte/reactivity';
import { applyPublicationBuildResult } from '$lib/post-builder/apply';
import { firstComposerURL } from './composer-links';
import { previewMeme, memePreviewDataURL, suggestMemes, renderMeme } from '$lib/meme-generator/api';
import { getLocaleTag } from '$lib/i18n';
import { joinPostText } from '@openpost/platform-text/mentions';
import type { ComposerHost } from './composer-host';
import {
	attachmentRequirementSchema,
	type AIPlatformStrategy,
	type AttachmentRequirement
} from './ai-build-metadata';

const AI_OPPORTUNITY_SLOW_DELAY_MS = 8_000;

interface AIComposerCheckpoint {
	selectedAccountIds: string[];
	selectedSocialSetId: string;
	posts: PostItem[];
	variants: Array<[string, Record<string, VariantPost>]>;
	linkUrl: string;
	requestedOutputProfiles: Record<string, string>;
	formatLockedByAccount: Record<string, boolean>;
	strategies: AIPlatformStrategy[];
	attachmentRequirements: Record<string, AttachmentRequirement>;
}

function repurposePrivateContext(handoff: RepurposeHandoff): string {
	const evidence = (handoff.evidence ?? []).map((item) => {
		const metric = item.metric.replaceAll('_', ' ');
		const period =
			item.metadata.period_start && item.metadata.period_end
				? `, period ${item.metadata.period_start}–${item.metadata.period_end}`
				: '';
		return `${metric}: ${item.value} ${item.metadata.unit} (${item.scope}, ${item.metadata.aggregation}, source ${item.metadata.source || handoff.provenance.platform}, collected ${item.collected_at}${period})`;
	});
	return [
		m.compose_ai_repurpose_private_provenance({
			origin: handoff.provenance.origin,
			platform: handoff.provenance.platform,
			date: handoff.provenance.published_at
		}),
		m.compose_ai_repurpose_private_evidence(),
		...(evidence.length ? evidence : [m.compose_ai_repurpose_no_evidence()])
	].join('\n');
}

function aiBuildStorageKey(workspaceID: string): string {
	return `openpost:publication-build:${workspaceID}`;
}

type AIBuilderHost = Pick<
	ComposerHost,
	| 'composerDestroyed'
	| 'validationIssues'
	| 'handleVariantChange'
	| 'scheduleCapabilityResolve'
	| 'selectedWorkspaceId'
	| 'publicationId'
	| 'error'
	| 'accounts'
	| 'selectedAccountIds'
	| 'selectedAccounts'
	| 'selectedSocialSetId'
	| 'requestedOutputProfiles'
	| 'formatLockedByAccount'
	| 'posts'
	| 'activePostIndex'
	| 'isThread'
	| 'variants'
	| 'activeVariantAccountId'
	| 'linkUrl'
	| 'composerMediaLimit'
	| 'hasPendingPasteMediaUploads'
	| 'imagePreparationContext'
	| 'mediaPickerOpen'
	| 'mediaPickerPostIndex'
	| 'mediaPickerInitialFiles'
	| 'mediaPickerInitialMode'
	| 'accountContextLabel'
	| 'prepareNewImageIds'
	| 'hydrateMediaMetadata'
	| 'generateMissingMediaAltText'
	| 'saveDraft'
	| 'scheduleAutoSave'
	| 'resolveCapabilities'
	| 'startFirstComposition'
>;

/**
 * The composer's AI post builder: ideation, angle planning, durable build polling, option and
 * meme application, and the checkpoints that let the author undo a generated result.
 */
export class ComposerAIBuilder {
	private readonly host: AIBuilderHost;

	requirementReviewId = $state('');

	requirementReviewText = $state('');

	aiAttachmentRequirements = $state.raw<Record<string, AttachmentRequirement>>({});

	private modalApply: import('$lib/post-builder/ideate.svelte').IdeateEntry['apply'];

	buildingPost = $state(false);

	postBuilderError = $state('');

	aiWorkspaceOpen = $state(false);

	aiWorkspaceEntry = $state<AIWorkspaceEntry>('build');

	aiWorkspaceStep = $state<AIWorkspaceStep>('angles');

	aiPostOptions = $state.raw<PublicationPostOption[]>([]);

	private aiOptionMedia = $state.raw<Record<string, string[]> | undefined>();

	private aiOpportunities = $state.raw<PublicationOpportunity[]>([]);

	aiSelectedOpportunityID = $state('');

	aiAngles = $state.raw<PublicationBuildAngle[]>([]);

	aiSelectedAngleID = $state('');

	aiOpportunityLoading = $state(false);

	aiFindingMore = $state(false);

	aiCancelling = $state(false);

	aiObjective = $state('');

	aiChangeRequest = $state('');

	aiIdeationBrief = $state('');

	aiContextNotes = $state('');

	aiContextURLs = $state('');

	aiContextMayPublish = $state(false);

	repurposePrivateContextNotes = $state('');

	repurposeReviewActive = $state(false);

	aiVoiceName = $state<string>(m.compose_ai_default_voice());

	aiVoiceProfileID = $state('');

	aiActiveBuild = $state.raw<PublicationBuild | null>(null);

	aiPendingResult = $state.raw<PublicationBuildResult | null>(null);

	aiAppliedResult = $state.raw<PublicationBuildResult | null>(null);

	aiAppliedStrategies = $state.raw<AIPlatformStrategy[]>([]);

	aiApplyPending = $state(false);

	private aiGenerationBaseline = '';

	aiGenerationIdea = '';

	aiBuildPublicationID = '';

	private aiPollTimer: ReturnType<typeof setTimeout> | null = null;

	private aiOpportunitySlowTimer: ReturnType<typeof setTimeout> | null = null;

	aiOpportunitySlow = $state(false);

	aiBuildCreateRejected = $state(false);

	private aiRequestController: AbortController | null = null;

	private aiVoiceRequestController: AbortController | null = null;

	aiMemeCandidates = $state.raw<AIMemeRecommendationCandidate[]>([]);

	aiMemeSelectedID = $state('');

	aiMemeError = $state('');

	private aiMemeTargetAccountIDs = $state.raw<string[]>([]);

	private aiMemeWorkspaceID = '';

	private aiMemeRequestGeneration = 0;

	private mediaPickerMemeTargetAccountIDs: string[] = [];

	private mediaPickerMemeRequestGeneration = 0;

	generationUndo = $state.raw<AIComposerCheckpoint | null>(null);

	latestGenerationUndo = $state.raw<AIComposerCheckpoint | null>(null);

	mediaPickerMemeIdea = $state('');

	mediaPickerMemeCandidate = $state.raw<MemeSuggestionCandidate | undefined>(undefined);

	mediaPickerMemePreview = $state('');

	readonly aiWorkspaceCopy: AIWorkspaceDialogCopy = {
		ideateTitle: m.compose_ai_ideate_title(),
		ideateDescription: m.compose_ai_ideate_description(),
		buildTitle: m.compose_ai_angles_title(),
		buildDescription: m.compose_ai_angles_description(),
		back: m.compose_ai_back_to_ideas(),
		dismiss: m.common_dismiss(),
		getIdeas: m.compose_ai_get_ideas(),
		continue: m.compose_ai_continue(),
		findMore: m.compose_ai_find_more(),
		findingMore: m.compose_ai_finding_more(),
		buildDrafts: m.compose_ai_build_drafts(),
		cancel: m.compose_ai_cancel_build(),
		cancelling: m.compose_ai_cancelling(),
		retry: m.common_retry(),
		keepEdits: m.compose_ai_keep_edits(),
		reviewApply: m.compose_ai_review_apply(),
		opportunities: {
			heading: m.compose_ai_opportunities_heading(),
			description: m.compose_ai_opportunities_description(),
			whyItFits: m.compose_ai_why_it_fits(),
			bestFor: m.compose_ai_best_for(),
			media: m.compose_ai_media(),
			noMedia: m.compose_ai_no_media_needed(),
			loading: m.compose_ai_finding_ideas(),
			emptyTitle: m.compose_ai_no_ideas_title(),
			emptyDescription: m.compose_ai_no_ideas_description(),
			selected: m.compose_ai_selected_idea()
		},
		angles: {
			heading: m.compose_ai_five_angles_heading(),
			description: m.compose_ai_five_angles_description(),
			loading: m.compose_ai_planning_angles(),
			emptyTitle: m.compose_ai_no_angles_title(),
			emptyDescription: m.compose_ai_no_angles_description(),
			recommended: m.compose_ai_recommended(),
			bestFor: m.compose_ai_aim(),
			evidence: m.compose_ai_uses(),
			media: m.compose_ai_media(),
			noMedia: m.compose_ai_no_media_needed(),
			selected: m.compose_ai_selected_angle()
		},
		progress: {
			heading: m.compose_ai_progress_heading(),
			description: m.compose_ai_progress_description()
		}
	};

	readonly repurposeWorkspaceCopy: AIWorkspaceDialogCopy = {
		...this.aiWorkspaceCopy,
		buildTitle: m.compose_ai_repurpose_review_title(),
		buildDescription: m.compose_ai_repurpose_review_description(),
		angles: {
			...this.aiWorkspaceCopy.angles,
			heading: m.compose_ai_repurpose_review_heading(),
			description: m.compose_ai_repurpose_review_hint()
		}
	};

	readonly aiMemeCopy: AIMemeRecommendationCopy = {
		title: m.compose_ai_meme_title(),
		description: m.compose_ai_meme_description(),
		recommendedLabel: m.compose_ai_meme_best_fit(),
		alternativesLabel: m.compose_ai_meme_alternatives(),
		useLabel: m.compose_ai_meme_use(),
		usingLabel: m.compose_ai_meme_adding(),
		editLabel: m.compose_ai_meme_edit(),
		editingLabel: m.compose_ai_meme_opening(),
		retryLabel: m.compose_ai_meme_retry_preview(),
		retryingLabel: m.compose_ai_meme_rendering_preview(),
		previewLoading: m.compose_ai_meme_preview_loading(),
		previewUnavailable: m.compose_ai_meme_preview_unavailable(),
		emptyTitle: m.compose_ai_meme_empty_title(),
		emptyDescription: m.compose_ai_meme_empty_description(),
		actionFailed: m.compose_ai_meme_action_failed(),
		selectAlternative: (templateName, position) =>
			m.compose_ai_meme_select_alternative({ templateName, position })
	};

	readonly aiWorkspaceOpportunities = $derived<AIOpportunity[]>(
		this.aiOpportunities.map((opportunity) => ({
			id: opportunity.id,
			title: opportunity.title,
			premise: opportunity.hook || opportunity.why_now,
			whyItFits: opportunity.why_it_fits,
			objective: opportunity.platform_treatments[0]?.objective,
			media: opportunity.platform_treatments[0]?.media,
			mediaRecommendation: opportunity.platform_treatments[0]?.media
		}))
	);

	readonly aiWorkspaceAngles = $derived<AIAngle[]>(
		this.aiAngles.map((angle) => ({
			id: angle.id,
			title: angle.label,
			premise: angle.hook,
			objective: angle.desired_reaction || angle.objective,
			evidence: angle.evidence,
			mediaRecommendation: angle.media.treatment === 'none' ? '' : angle.media.brief,
			recommended: angle.id === 'recommended',
			preservesCurrentAngle: angle.id === 'keep_current'
		}))
	);

	readonly aiGenerationPhases = $derived.by<AIGenerationPhase[]>(() => {
		const phase = this.aiActiveBuild?.phase ?? 'queued';
		const reachedCreation = ['drafting', 'reviewing', 'ready', 'committed'].includes(phase);
		const reachedReview = ['reviewing', 'ready', 'committed'].includes(phase);
		const finished = ['ready', 'committed'].includes(phase);
		return [
			{
				id: 'understanding',
				label: m.compose_ai_phase_understanding(),
				status: reachedCreation ? 'complete' : 'active'
			},
			{
				id: 'creating',
				label: m.compose_ai_phase_creating(),
				status: reachedReview ? 'complete' : reachedCreation ? 'active' : 'pending'
			},
			{
				id: 'checking',
				label: m.compose_ai_phase_checking(),
				status: finished ? 'complete' : reachedReview ? 'active' : 'pending'
			}
		];
	});

	readonly aiGenerationMessage = $derived(
		this.aiApplyPending
			? m.compose_ai_progress_conflict()
			: this.aiActiveBuild?.state === 'failed'
				? this.aiActiveBuild.error_message || m.compose_ai_progress_stopped()
				: this.aiActiveBuild?.state === 'ready'
					? m.compose_ai_progress_ready()
					: m.compose_ai_progress_resumable()
	);

	readonly aiGenerationActive = $derived(
		Boolean(this.aiBuildPublicationID) &&
			(this.aiActiveBuild === null ||
				this.aiActiveBuild.state === 'queued' ||
				this.aiActiveBuild.state === 'building')
	);

	readonly visibleAIStrategies = $derived(
		this.aiAppliedStrategies.filter(
			(destination) =>
				!this.host.activeVariantAccountId ||
				destination.account_id === this.host.activeVariantAccountId
		)
	);

	private composerAISnapshot = (): string => {
		return (
			JSON.stringify(this.aiAttachmentRequirements) +
			composerBuildFingerprint({
				posts: this.host.posts,
				variants: this.host.variants,
				linkUrl: this.host.linkUrl,
				accountIds: this.host.selectedAccountIds,
				requestedOutputProfiles: this.host.requestedOutputProfiles,
				formatLockedByAccount: this.host.formatLockedByAccount
			})
		);
	};

	private selectedAIPlatforms = (): string[] => {
		return [
			...new Set(this.host.selectedAccounts.map((account) => getPlatformKey(account.platform)))
		];
	};

	selectedAIAssets = (): NonNullable<PublicationBuildRequest['assets']> => {
		return [...new Set(this.host.posts.flatMap((post) => post.mediaIds))]
			.slice(0, 10)
			.map((mediaID) => ({
				media_id: mediaID,
				role: 'context' as const,
				may_publish: true
			}));
	};

	private parsedAIContextURLs = (): string[] => {
		return [
			...new Set(
				this.aiContextURLs
					.split(/\s+/)
					.map((value) => value.trim())
					.filter(Boolean)
			)
		].slice(0, 10);
	};

	private publicationBuildRequest = (
		idea: string,
		angle?: PublicationBuildAngle
	): PublicationBuildRequest => {
		const buildDirection = angle?.build_direction;
		const request: PublicationBuildRequest = {
			workspace_id: this.host.selectedWorkspaceId,
			idea,
			account_ids: [...this.host.selectedAccountIds],
			direction: {
				outcome: this.aiObjective.trim() || buildDirection?.outcome,
				audience: buildDirection?.audience,
				angle: buildDirection?.angle,
				tone_adjustment: this.aiChangeRequest.trim() || undefined,
				media_preference: buildDirection?.media_preference
			},
			destination_policy: 'require_all'
		};
		if (this.host.selectedSocialSetId) request.social_set_id = this.host.selectedSocialSetId;
		if (this.aiVoiceProfileID) request.voice_profile_id = this.aiVoiceProfileID;
		const contextURLs = this.parsedAIContextURLs();
		if (contextURLs.length > 0) request.context_urls = contextURLs;
		const privateContextNotes = this.repurposePrivateContextNotes.trim();
		const contextNotes = [privateContextNotes, this.aiContextNotes.trim()]
			.filter(Boolean)
			.join('\n\n');
		if (contextNotes) {
			request.context_notes = contextNotes;
			request.context_may_publish = privateContextNotes ? false : this.aiContextMayPublish;
		}
		const assets = this.selectedAIAssets();
		if (assets.length > 0) request.assets = assets;
		return request;
	};

	private loadAIWorkspaceVoice = async (workspaceID: string): Promise<void> => {
		if (!workspaceID) return;
		this.aiVoiceRequestController?.abort();
		const controller = new AbortController();
		this.aiVoiceRequestController = controller;
		if (workspaceID === this.host.selectedWorkspaceId) {
			this.aiVoiceName = m.compose_ai_default_voice();
			this.aiVoiceProfileID = '';
		}
		try {
			const profiles = await queryVoiceProfiles(workspaceID, controller.signal);
			if (workspaceID !== this.host.selectedWorkspaceId) return;
			const profile = profiles.find((candidate) => candidate.is_default) ?? profiles[0];
			if (profile) {
				this.aiVoiceName = profile.name;
				this.aiVoiceProfileID = '';
			}
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			if (workspaceID !== this.host.selectedWorkspaceId) return;
			this.aiVoiceName = m.compose_ai_default_voice();
			this.aiVoiceProfileID = '';
		} finally {
			if (this.aiVoiceRequestController === controller) this.aiVoiceRequestController = null;
		}
	};

	loadPublicationOpportunities = async (findMore = false): Promise<void> => {
		if (!this.host.selectedWorkspaceId || this.selectedAIPlatforms().length === 0) return;
		this.aiBuildCreateRejected = false;
		this.aiRequestController?.abort();
		const controller = new AbortController();
		this.aiRequestController = controller;
		if (this.aiOpportunitySlowTimer) clearTimeout(this.aiOpportunitySlowTimer);
		this.aiOpportunitySlow = false;
		this.aiOpportunitySlowTimer = setTimeout(() => {
			if (this.aiRequestController === controller) this.aiOpportunitySlow = true;
		}, AI_OPPORTUNITY_SLOW_DELAY_MS);
		if (findMore) this.aiFindingMore = true;
		else this.aiOpportunityLoading = true;
		this.postBuilderError = '';
		try {
			const result = await discoverPublicationOpportunities(
				{
					workspace_id: this.host.selectedWorkspaceId,
					focus: this.aiIdeationBrief.trim() || undefined,
					voice_profile_id: this.aiVoiceProfileID || undefined,
					platforms: this.selectedAIPlatforms().slice(0, 5),
					limit: 4
				},
				controller.signal
			);
			this.aiOpportunities = findMore
				? [
						...this.aiOpportunities,
						...result.opportunities.filter(
							(candidate) => !this.aiOpportunities.some((current) => current.id === candidate.id)
						)
					].slice(0, 12)
				: result.opportunities;
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			this.postBuilderError =
				cause instanceof Error && cause.message ? cause.message : m.compose_ai_find_ideas_failed();
		} finally {
			if (this.aiRequestController === controller) {
				if (this.aiOpportunitySlowTimer) clearTimeout(this.aiOpportunitySlowTimer);
				this.aiOpportunitySlowTimer = null;
				this.aiOpportunitySlow = false;
				this.aiOpportunityLoading = false;
				this.aiFindingMore = false;
			}
		}
	};

	discoverPublicationIdeas = async (): Promise<void> => {
		this.aiWorkspaceStep = 'opportunities';
		this.aiSelectedOpportunityID = '';
		this.aiGenerationIdea = '';
		await this.loadPublicationOpportunities();
	};

	loadPublicationAngles = async (idea: string): Promise<void> => {
		this.aiBuildCreateRejected = false;
		this.aiRequestController?.abort();
		this.aiRequestController = new AbortController();
		this.buildingPost = true;
		this.postBuilderError = '';
		this.aiWorkspaceStep = 'angles';
		this.aiAngles = [];
		this.aiSelectedAngleID = '';
		try {
			const result = await planPublicationAngles(
				this.publicationBuildRequest(idea),
				this.aiRequestController.signal
			);
			this.aiAngles = result.angles;
			const selectedAngle = result.angles.find((angle) => angle.id === 'recommended');
			this.aiSelectedAngleID = selectedAngle?.id ?? '';
			this.aiObjective = selectedAngle?.objective ?? '';
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			this.postBuilderError =
				cause instanceof Error && cause.message ? cause.message : m.compose_ai_plan_angles_failed();
		} finally {
			this.buildingPost = false;
		}
	};

	selectPublicationOpportunity = (opportunity: AIOpportunity): void => {
		const selected = this.aiOpportunities.find((candidate) => candidate.id === opportunity.id);
		if (!selected) return;
		this.aiSelectedOpportunityID = selected.id;
		this.aiGenerationIdea = [selected.title, selected.hook, selected.why_now]
			.filter(Boolean)
			.join('\n\n');
	};

	continuePublicationOpportunity = async (): Promise<void> => {
		if (!this.aiSelectedOpportunityID || !this.aiGenerationIdea.trim()) return;
		this.aiIdeationBrief = this.aiGenerationIdea;
		await this.startSelectedPublicationBuild();
	};

	buildPostWithAI = async () => {
		if (
			this.buildingPost ||
			this.host.isThread ||
			this.host.activeVariantAccountId ||
			this.host.hasPendingPasteMediaUploads
		)
			return;
		const sourcePost = this.host.posts[0];
		if (!sourcePost || !this.host.selectedWorkspaceId) return;
		const workspaceID = this.host.selectedWorkspaceId;
		const targetID = this.host.publicationId;
		const baseline = this.composerAISnapshot();
		const request = this.publicationBuildRequest(sourcePost.content.trim());
		this.modalApply = async (option, media) => {
			if (
				this.host.composerDestroyed ||
				workspaceID !== this.host.selectedWorkspaceId ||
				(targetID && targetID !== this.host.publicationId) ||
				this.composerAISnapshot() !== baseline
			) {
				throw new Error(m.compose_ai_progress_conflict());
			}
			this.aiPendingResult = option;
			this.aiOptionMedia = media;
			this.applyReadyPublicationBuild(
				option.destinations.map((destination) => destination.account_id)
			);
		};
		ideate.show({
			workspaceId: workspaceID,
			contextKey: `composer:${targetID || sourcePost.key}`,
			input: request,
			apply: this.modalApply
		});
	};

	private persistActivePublicationBuild = (
		build: PublicationBuild,
		publicationID = this.aiBuildPublicationID,
		baseline = this.aiGenerationBaseline
	): void => {
		if (!publicationID) return;
		localStorage.setItem(
			aiBuildStorageKey(build.workspace_id),
			JSON.stringify({ id: build.id, publication_id: publicationID, baseline })
		);
	};

	private clearActivePublicationBuild = (): void => {
		if (this.host.selectedWorkspaceId)
			localStorage.removeItem(aiBuildStorageKey(this.host.selectedWorkspaceId));
		if (this.aiPollTimer) clearTimeout(this.aiPollTimer);
		this.aiPollTimer = null;
		this.aiBuildPublicationID = '';
		this.aiActiveBuild = null;
	};

	private ensureAIBuildPublicationID = async (workspaceID: string): Promise<string | null> => {
		if (this.host.publicationId) return this.host.publicationId;
		const savedPublicationID = await this.host.saveDraft({ allowEmpty: true });
		if (savedPublicationID) return savedPublicationID;
		if (this.host.selectedWorkspaceId !== workspaceID) return null;
		this.postBuilderError = this.host.error || m.compose_save_draft_failed();
		return null;
	};

	startSelectedPublicationBuild = async (): Promise<void> => {
		if (this.buildingPost) return;
		const angle = this.aiAngles.find((candidate) => candidate.id === this.aiSelectedAngleID);
		const idea = this.repurposeReviewActive ? this.aiGenerationIdea : this.aiIdeationBrief;
		if ((this.repurposeReviewActive && !angle) || !idea.trim()) return;
		const buildWorkspaceID = this.host.selectedWorkspaceId;
		this.buildingPost = true;
		this.postBuilderError = '';
		this.aiBuildCreateRejected = false;
		this.aiApplyPending = false;
		this.aiPendingResult = null;
		const buildPublicationID = await this.ensureAIBuildPublicationID(buildWorkspaceID);
		if (!buildPublicationID) {
			if (this.host.selectedWorkspaceId === buildWorkspaceID) {
				this.buildingPost = false;
				this.aiBuildCreateRejected = true;
			}
			return;
		}
		if (this.host.selectedWorkspaceId !== buildWorkspaceID) return;
		const buildBaseline = this.composerAISnapshot();
		try {
			const build = await createPublicationBuild(
				{
					...this.publicationBuildRequest(idea, angle),
					option_count: this.repurposeReviewActive ? 0 : 4
				},
				`composer-${crypto.randomUUID()}`
			);
			if (
				build.workspace_id !== buildWorkspaceID ||
				this.host.selectedWorkspaceId !== buildWorkspaceID ||
				this.host.publicationId !== buildPublicationID
			) {
				return;
			}
			this.aiWorkspaceStep = 'generating';
			this.aiBuildPublicationID = buildPublicationID;
			this.aiGenerationBaseline = buildBaseline;
			this.aiActiveBuild = build;
			this.persistActivePublicationBuild(build, buildPublicationID, buildBaseline);
			await this.handlePublicationBuildState(build);
		} catch (cause) {
			if (
				this.host.selectedWorkspaceId !== buildWorkspaceID ||
				this.host.publicationId !== buildPublicationID
			) {
				return;
			}
			this.buildingPost = false;
			this.aiWorkspaceStep = 'angles';
			this.aiBuildCreateRejected = true;
			this.aiBuildPublicationID = '';
			this.aiActiveBuild = null;
			this.postBuilderError =
				cause instanceof Error && cause.message ? cause.message : m.compose_ai_build_failed();
			soundPreferences.play('error');
		}
	};

	private pollPublicationBuild = async (id: string): Promise<void> => {
		if (this.aiPollTimer) clearTimeout(this.aiPollTimer);
		this.aiPollTimer = setTimeout(async () => {
			try {
				await this.handlePublicationBuildState(await getPublicationBuild(id));
			} catch (cause) {
				this.buildingPost = false;
				this.postBuilderError =
					cause instanceof Error && cause.message
						? cause.message
						: m.compose_ai_check_build_failed();
			}
		}, 1200);
	};

	private handlePublicationBuildState = async (build: PublicationBuild): Promise<void> => {
		if (
			build.workspace_id !== this.host.selectedWorkspaceId ||
			!this.aiBuildPublicationID ||
			this.aiBuildPublicationID !== this.host.publicationId
		) {
			return;
		}
		this.aiActiveBuild = build;
		if (build.state === 'queued' || build.state === 'building') {
			this.buildingPost = true;
			this.persistActivePublicationBuild(build);
			await this.pollPublicationBuild(build.id);
			return;
		}
		this.buildingPost = false;
		if (build.state === 'ready' && build.result) {
			if (build.result.options?.length) {
				this.aiPostOptions = structuredClone(build.result.options);
				this.aiPendingResult = build.result;
				this.aiWorkspaceStep = 'options';
				this.aiWorkspaceOpen = true;
				return;
			}
			this.aiPendingResult = build.result;
			if (this.aiGenerationBaseline && this.composerAISnapshot() !== this.aiGenerationBaseline) {
				this.aiApplyPending = true;
				this.aiWorkspaceOpen = true;
				this.aiWorkspaceStep = 'generating';
				return;
			}
			this.applyReadyPublicationBuild();
			return;
		}
		if (build.state === 'failed') {
			this.postBuilderError = build.error_message || m.compose_ai_build_failed();
			soundPreferences.play('error');
			return;
		}
		if (build.state === 'cancelled') {
			this.clearActivePublicationBuild();
			this.aiWorkspaceOpen = false;
		}
	};

	useAIPostOption = async (option: PublicationPostOption): Promise<void> => {
		if (this.buildingPost) return;
		const workspaceID = this.host.selectedWorkspaceId;
		const expectedPublicationID = this.host.publicationId;
		this.buildingPost = true;
		this.postBuilderError = '';
		const mediaByAccount: Record<string, string[]> = {};
		try {
			const saved = new Map<string, string>();
			for (const destination of option.destinations) {
				mediaByAccount[destination.account_id] = [];
				if (
					destination.media.treatment === 'use_source' &&
					destination.media.source_ref?.startsWith('media:')
				)
					mediaByAccount[destination.account_id] = [destination.media.source_ref.slice(6)];
				const recipe = destination.media.document;
				if (!recipe) continue;
				const key = JSON.stringify(recipe);
				let id = saved.get(key);
				if (!id) {
					id = (
						await savePostVisual(
							workspaceID,
							{ document: recipe },
							destination.media.alt_text ?? ''
						)
					).id;
					saved.set(key, id);
				}
				if (
					workspaceID !== this.host.selectedWorkspaceId ||
					expectedPublicationID !== this.host.publicationId
				)
					return;
				mediaByAccount[destination.account_id] = [id];
			}
			this.aiOptionMedia = mediaByAccount;
			this.aiPendingResult = option;
			if (this.aiGenerationBaseline && this.composerAISnapshot() !== this.aiGenerationBaseline) {
				this.aiApplyPending = true;
				this.aiWorkspaceStep = 'generating';
				return;
			}
			this.applyReadyPublicationBuild();
		} catch (cause) {
			if (workspaceID === this.host.selectedWorkspaceId)
				this.postBuilderError =
					cause instanceof Error ? cause.message : m.compose_ai_build_failed();
		} finally {
			if (workspaceID === this.host.selectedWorkspaceId) this.buildingPost = false;
		}
	};

	private captureAIComposerCheckpoint = (): AIComposerCheckpoint => {
		return {
			selectedAccountIds: [...this.host.selectedAccountIds],
			selectedSocialSetId: this.host.selectedSocialSetId,
			posts: this.host.posts.map((post) => ({ ...post, mediaIds: [...post.mediaIds] })),
			variants: Array.from(this.host.variants.entries()).map(([accountID, record]) => [
				accountID,
				structuredClone(record)
			]),
			linkUrl: this.host.linkUrl,
			requestedOutputProfiles: { ...this.host.requestedOutputProfiles },
			formatLockedByAccount: { ...this.host.formatLockedByAccount },
			strategies: structuredClone(this.aiAppliedStrategies),
			attachmentRequirements: structuredClone(this.aiAttachmentRequirements)
		};
	};

	private restoreAIComposerCheckpoint = (checkpoint: AIComposerCheckpoint): void => {
		this.host.selectedAccountIds = [...checkpoint.selectedAccountIds];
		this.host.selectedSocialSetId = checkpoint.selectedSocialSetId;
		this.host.posts = checkpoint.posts.map((post) => ({ ...post, mediaIds: [...post.mediaIds] }));
		this.host.variants = new SvelteMap(
			checkpoint.variants.map(([accountID, record]) => [accountID, structuredClone(record)])
		);
		this.host.linkUrl = checkpoint.linkUrl;
		this.host.requestedOutputProfiles = { ...checkpoint.requestedOutputProfiles };
		this.host.formatLockedByAccount = { ...checkpoint.formatLockedByAccount };
		this.aiAppliedStrategies = structuredClone(checkpoint.strategies);
		this.aiAttachmentRequirements = structuredClone(checkpoint.attachmentRequirements);
		this.aiAppliedResult = null;
		this.aiMemeCandidates = [];
		this.aiMemeError = '';
		this.postBuilderError = '';
		this.host.activePostIndex = 0;
		this.host.activeVariantAccountId = null;
		void this.host.resolveCapabilities();
		this.host.scheduleAutoSave();
	};

	applyReadyPublicationBuild = (destinations?: string[]): void => {
		const result = this.aiPendingResult;
		const sourcePost = this.host.posts[0];
		if (!result || !sourcePost) return;
		const checkpoint = this.captureAIComposerCheckpoint();
		if (!this.generationUndo) this.generationUndo = checkpoint;
		this.latestGenerationUndo = checkpoint;
		if (destinations) {
			this.host.selectedAccountIds = destinations;
			this.host.selectedSocialSetId = '';
		}
		const applied = applyPublicationBuildResult(result, sourcePost, this.aiOptionMedia);
		this.host.posts = applied.posts;
		this.host.variants = new SvelteMap(Object.entries(applied.variants));
		this.host.requestedOutputProfiles = {
			...this.host.requestedOutputProfiles,
			...applied.requestedOutputProfiles
		};
		this.host.formatLockedByAccount = {
			...this.host.formatLockedByAccount,
			...applied.formatLockedByAccount
		};
		this.host.activePostIndex = 0;
		this.host.activeVariantAccountId = null;
		this.host.linkUrl = firstComposerURL(this.host.posts[0]?.content ?? '');
		this.aiAttachmentRequirements = Object.fromEntries(
			result.destinations.flatMap((destination) => {
				const kind =
					destination.media.treatment === 'attach_image'
						? 'image'
						: destination.media.treatment === 'attach_video'
							? 'video'
							: '';
				return kind
					? [
							[
								destination.account_id,
								attachmentRequirementSchema.parse({ kind, brief: destination.media.brief })
							]
						]
					: [];
			})
		);
		this.aiAppliedResult = result;
		this.aiAppliedStrategies = result.destinations.map((destination) => ({
			account_id: destination.account_id,
			platform: destination.platform,
			objective: destination.objective,
			archetype: destination.archetype,
			media: structuredClone(destination.media),
			warnings: destination.warnings ? [...destination.warnings] : undefined
		}));
		this.aiApplyPending = false;
		this.aiPendingResult = null;
		this.aiWorkspaceOpen = false;
		this.clearActivePublicationBuild();
		this.postBuilderError = (result.skipped ?? [])
			.map((destination) => `${getPlatformName(destination.platform)}: ${destination.reason}`)
			.join(' ');
		if (!this.aiOptionMedia) void this.loadAIMemeRecommendations(result);
		this.aiPostOptions = [];
		this.aiOptionMedia = undefined;
		void this.host.startFirstComposition('text');
		void this.host.resolveCapabilities();
		soundPreferences.play('success');
		this.host.scheduleAutoSave();
	};

	private aiMemeRecipe = (candidate: AIMemeRecommendationCandidate) => {
		return {
			workspaceId: this.host.selectedWorkspaceId,
			templateId: candidate.suggestion.template_id,
			captions: candidate.suggestion.caption_lines,
			overlayMediaIds: [],
			format: 'png' as const,
			altText: candidate.suggestion.alt_text
		};
	};

	previewAIMemeCandidate = async (
		candidate: AIMemeRecommendationCandidate,
		generation = this.aiMemeRequestGeneration,
		workspaceID = this.aiMemeWorkspaceID
	): Promise<void> => {
		if (
			generation !== this.aiMemeRequestGeneration ||
			workspaceID !== this.host.selectedWorkspaceId
		)
			return;
		this.aiMemeCandidates = this.aiMemeCandidates.map((current) =>
			current.id === candidate.id ? { ...current, previewState: 'loading' } : current
		);
		try {
			const preview = await previewMeme(this.aiMemeRecipe(candidate));
			if (
				generation !== this.aiMemeRequestGeneration ||
				workspaceID !== this.host.selectedWorkspaceId
			)
				return;
			this.aiMemeCandidates = this.aiMemeCandidates.map((current) =>
				current.id === candidate.id
					? { ...current, previewUrl: memePreviewDataURL(preview), previewState: 'ready' }
					: current
			);
		} catch {
			if (
				generation !== this.aiMemeRequestGeneration ||
				workspaceID !== this.host.selectedWorkspaceId
			)
				return;
			this.aiMemeCandidates = this.aiMemeCandidates.map((current) =>
				current.id === candidate.id ? { ...current, previewState: 'failed' } : current
			);
		}
	};

	private loadAIMemeRecommendations = async (result: PublicationBuildResult): Promise<void> => {
		const generation = ++this.aiMemeRequestGeneration;
		const workspaceID = this.host.selectedWorkspaceId;
		const memeDestinations = result.destinations.filter(
			(destination) => destination.media.treatment === 'meme'
		);
		this.aiMemeCandidates = [];
		this.aiMemeTargetAccountIDs = [];
		this.aiMemeWorkspaceID = '';
		this.aiMemeError = '';
		if (memeDestinations.length === 0) {
			return;
		}
		const targetAccountIDs = memeDestinations.map((destination) => destination.account_id);
		this.aiMemeTargetAccountIDs = targetAccountIDs;
		this.aiMemeWorkspaceID = workspaceID;
		try {
			const suggestions = await suggestMemes({
				workspaceId: workspaceID,
				idea: [result.direction.angle, memeDestinations[0]?.media.brief]
					.filter(Boolean)
					.join('\n\n'),
				tone: 'balanced',
				language: getLocaleTag(),
				count: 3
			});
			if (
				generation !== this.aiMemeRequestGeneration ||
				workspaceID !== this.host.selectedWorkspaceId
			)
				return;
			this.aiMemeCandidates = suggestions.candidates.slice(0, 3).map((suggestion, index) => ({
				id: `${suggestion.template_id}:${index}`,
				suggestion,
				previewState: 'loading'
			}));
			this.aiMemeSelectedID = this.aiMemeCandidates[0]?.id ?? '';
			for (let index = 0; index < this.aiMemeCandidates.length; index += 2) {
				await Promise.all(
					this.aiMemeCandidates
						.slice(index, index + 2)
						.map((candidate) => this.previewAIMemeCandidate(candidate, generation, workspaceID))
				);
			}
		} catch (cause) {
			if (
				generation !== this.aiMemeRequestGeneration ||
				workspaceID !== this.host.selectedWorkspaceId
			)
				return;
			this.aiMemeError = cause instanceof Error ? cause.message : m.compose_ai_meme_unavailable();
		}
	};

	private canAttachAIMemeToTargets = (
		targetAccountIDs = this.aiMemeTargetAccountIDs,
		workspaceID = this.aiMemeWorkspaceID,
		mediaID = ''
	): boolean => {
		this.aiMemeError = '';
		const post = this.host.posts[0];
		if (
			!post ||
			targetAccountIDs.length === 0 ||
			workspaceID !== this.host.selectedWorkspaceId ||
			targetAccountIDs.some((accountID) => !this.host.selectedAccountIds.includes(accountID))
		) {
			this.aiMemeError = this.aiMemeCopy.actionFailed;
			return false;
		}
		for (const accountID of targetAccountIDs) {
			const record = normalizeVariantRecord(this.host.variants.get(accountID), this.host.posts);
			const current = record[post.key];
			const currentMediaIDs = current?.mediaInherited === false ? current.mediaIds : post.mediaIds;
			if (
				!currentMediaIDs.includes(mediaID) &&
				currentMediaIDs.length >= this.host.composerMediaLimit
			) {
				const account = this.host.accounts.find((candidate) => candidate.id === accountID);
				this.aiMemeError = m.compose_ai_meme_remove_media({
					account: account
						? this.host.accountContextLabel(account)
						: m.compose_ai_this_destination()
				});
				return false;
			}
		}
		return true;
	};

	private attachAIMemeToTargets = async (
		mediaID: string,
		targetAccountIDs = this.aiMemeTargetAccountIDs,
		workspaceID = this.aiMemeWorkspaceID
	): Promise<boolean> => {
		if (!mediaID || !this.canAttachAIMemeToTargets(targetAccountIDs, workspaceID, mediaID))
			return false;
		const post = this.host.posts[0];
		if (!post) return false;
		const context = this.host.imagePreparationContext;
		const prepared = await this.host.prepareNewImageIds([mediaID], workspaceID);
		if (
			!prepared ||
			context !== this.host.imagePreparationContext ||
			!this.canAttachAIMemeToTargets(targetAccountIDs, workspaceID, prepared[0])
		)
			return false;
		mediaID = prepared[0];
		const nextVariants = new SvelteMap(this.host.variants);
		for (const accountID of targetAccountIDs) {
			const record = normalizeVariantRecord(nextVariants.get(accountID), this.host.posts);
			const current = record[post.key];
			const currentMediaIDs = current?.mediaInherited === false ? current.mediaIds : post.mediaIds;
			record[post.key] = {
				...current,
				mediaIds: [...new Set([...currentMediaIDs, mediaID])],
				mediaInherited: false
			};
			nextVariants.set(accountID, record);
		}
		this.host.variants = nextVariants;
		await this.host.hydrateMediaMetadata(this.host.selectedWorkspaceId, [mediaID], true);
		void this.host.generateMissingMediaAltText([mediaID], post.content);
		this.host.scheduleAutoSave();
		return true;
	};

	useAIMeme = async (candidate: AIMemeRecommendationCandidate): Promise<void> => {
		const generation = this.aiMemeRequestGeneration;
		const workspaceID = this.aiMemeWorkspaceID;
		const targetAccountIDs = [...this.aiMemeTargetAccountIDs];
		if (!this.canAttachAIMemeToTargets(targetAccountIDs, workspaceID)) return;
		const rendered = await renderMeme(this.aiMemeRecipe(candidate));
		if (
			generation !== this.aiMemeRequestGeneration ||
			workspaceID !== this.host.selectedWorkspaceId
		)
			return;
		if (!(await this.attachAIMemeToTargets(rendered.media.id, targetAccountIDs, workspaceID)))
			return;
		this.aiMemeCandidates = [];
		soundPreferences.play('success');
	};

	editAIMeme = (candidate: AIMemeRecommendationCandidate): void => {
		if (!this.canAttachAIMemeToTargets(this.aiMemeTargetAccountIDs, this.aiMemeWorkspaceID)) return;
		this.host.mediaPickerPostIndex = 0;
		this.host.mediaPickerInitialFiles = [];
		this.host.mediaPickerInitialMode = 'meme';
		this.mediaPickerMemeIdea = this.aiGenerationIdea;
		this.mediaPickerMemeCandidate = candidate.suggestion;
		this.mediaPickerMemePreview = candidate.previewUrl ?? '';
		this.mediaPickerMemeTargetAccountIDs = [...this.aiMemeTargetAccountIDs];
		this.mediaPickerMemeRequestGeneration = this.aiMemeRequestGeneration;
		this.host.mediaPickerOpen = true;
	};

	/** Attaches a meme confirmed in the media picker to the destinations it was recommended for. */
	confirmPickerMeme = async (ids: string[]): Promise<boolean> => {
		let attached = false;
		if (this.mediaPickerMemeRequestGeneration === this.aiMemeRequestGeneration) {
			for (const mediaID of ids) {
				attached =
					(await this.attachAIMemeToTargets(
						mediaID,
						this.mediaPickerMemeTargetAccountIDs,
						this.host.selectedWorkspaceId
					)) || attached;
			}
		}
		if (!attached) return false;
		this.mediaPickerMemeIdea = '';
		this.mediaPickerMemeCandidate = undefined;
		this.mediaPickerMemePreview = '';
		this.mediaPickerMemeTargetAccountIDs = [];
		this.aiMemeCandidates = [];
		return true;
	};

	/** Returns the media picker to plain uploads before it opens for another purpose. */
	clearPickerMeme = () => {
		this.mediaPickerMemeIdea = '';
		this.mediaPickerMemeCandidate = undefined;
		this.mediaPickerMemePreview = '';
	};

	/** Saves the reviewed text for a destination and drops its AI media requirement. */
	saveRequirementWithoutMedia = () => {
		if (!this.host.posts[0]) return;
		const accountId = this.requirementReviewId;
		this.host.handleVariantChange(accountId, 0, this.requirementReviewText);
		const next = { ...this.aiAttachmentRequirements };
		delete next[accountId];
		this.aiAttachmentRequirements = next;
		const profiles = { ...this.host.requestedOutputProfiles };
		delete profiles[accountId];
		this.host.requestedOutputProfiles = profiles;
		this.host.formatLockedByAccount = { ...this.host.formatLockedByAccount, [accountId]: false };
		this.host.validationIssues = [];
		this.aiAppliedStrategies = this.aiAppliedStrategies.map((strategy) =>
			strategy.account_id === accountId
				? { ...strategy, media: { treatment: 'none', role: 'none', brief: '' } }
				: strategy
		);
		this.requirementReviewId = '';
		this.host.scheduleCapabilityResolve();
		this.host.scheduleAutoSave();
	};

	keepCurrentComposerEdits = (): void => {
		this.aiApplyPending = false;
		this.aiPendingResult = null;
		this.aiWorkspaceOpen = false;
		this.clearActivePublicationBuild();
	};

	cancelActivePublicationBuild = async (): Promise<void> => {
		if (!this.aiActiveBuild) return;
		this.aiCancelling = true;
		try {
			await this.handlePublicationBuildState(await cancelPublicationBuild(this.aiActiveBuild.id));
		} catch (cause) {
			this.postBuilderError =
				cause instanceof Error ? cause.message : m.compose_ai_cancel_build_failed();
		} finally {
			this.aiCancelling = false;
		}
	};

	retryActivePublicationBuild = async (): Promise<void> => {
		if (!this.aiActiveBuild) return;
		this.postBuilderError = '';
		this.buildingPost = true;
		try {
			await this.handlePublicationBuildState(await retryPublicationBuild(this.aiActiveBuild.id));
		} catch (cause) {
			this.buildingPost = false;
			this.postBuilderError = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
		}
	};

	restoreActivePublicationBuild = async (): Promise<void> => {
		if (!this.host.selectedWorkspaceId) return;
		const saved = localStorage.getItem(aiBuildStorageKey(this.host.selectedWorkspaceId));
		if (!saved) return;
		try {
			const parsed = z
				.object({
					id: z.string().min(1),
					publication_id: z.string().min(1),
					baseline: z.string().optional()
				})
				.safeParse(JSON.parse(saved));
			if (!parsed.success) {
				localStorage.removeItem(aiBuildStorageKey(this.host.selectedWorkspaceId));
				return;
			}
			if (parsed.data.publication_id !== this.host.publicationId) return;
			this.aiBuildPublicationID = parsed.data.publication_id;
			this.aiGenerationBaseline = parsed.data.baseline ?? '';
			this.aiWorkspaceEntry = this.host.posts[0]?.content.trim() ? 'build' : 'ideate';
			this.aiWorkspaceStep = 'generating';
			this.aiWorkspaceOpen = true;
			await this.handlePublicationBuildState(await getPublicationBuild(parsed.data.id));
		} catch {
			this.clearActivePublicationBuild();
		}
	};

	restoreIdea = () => {
		if (!this.generationUndo) return;
		this.restoreAIComposerCheckpoint(this.generationUndo);
		this.generationUndo = null;
		this.latestGenerationUndo = null;
	};

	undoLatestGenerationApply = () => {
		if (!this.latestGenerationUndo) return;
		const restoresOriginalIdea = this.latestGenerationUndo === this.generationUndo;
		this.restoreAIComposerCheckpoint(this.latestGenerationUndo);
		this.latestGenerationUndo = null;
		if (restoresOriginalIdea) this.generationUndo = null;
	};

	convertGeneratedThreadToPost = (): void => {
		if (!this.generationUndo || this.host.posts.length < 2) return;
		if (this.host.posts.slice(1).some((post) => post.poll)) {
			this.host.error = m.compose_poll_join_conflict();
			return;
		}
		const source = this.host.posts[0];
		let joinedSource: PostItem;
		const nextVariants = new SvelteMap<string, Record<string, VariantPost>>();
		try {
			const joined = joinPostText(
				this.host.posts.map((post) => ({ body: post.content, mentions: post.mentions?.spans }))
			);
			joinedSource = {
				...source,
				content: joined.body,
				mentions:
					joined.mentions === undefined ? undefined : { version: 1, spans: joined.mentions },
				mediaIds: [...new Set(this.host.posts.flatMap((post) => post.mediaIds))]
			};
			for (const [accountID, record] of this.host.variants.entries()) {
				const values = this.host.posts.map(
					(post) =>
						record[post.key] ?? {
							content: post.content,
							mentions: post.mentions,
							mediaIds: post.mediaIds,
							contentInherited: true,
							mediaInherited: true
						}
				);
				const projected = joinPostText(
					values.map((value, index) => ({
						body: value.contentInherited ? this.host.posts[index].content : value.content,
						mentions: (value.contentInherited ? this.host.posts[index].mentions : value.mentions)
							?.spans
					}))
				);
				nextVariants.set(accountID, {
					[joinedSource.key]: {
						content: projected.body,
						mentions:
							projected.mentions === undefined
								? undefined
								: { version: 1, spans: projected.mentions },
						mediaIds: [...new Set(values.flatMap((value) => value.mediaIds))],
						contentInherited: values.every((value) => value.contentInherited),
						mediaInherited: values.every((value) => value.mediaInherited)
					}
				});
			}
		} catch {
			this.host.error = m.editor_mention_limit();
			return;
		}
		this.host.posts = [joinedSource];
		this.host.variants = nextVariants;
		this.host.activePostIndex = 0;
		this.host.linkUrl = firstComposerURL(joinedSource.content);
		void this.host.resolveCapabilities();
		this.host.scheduleAutoSave();
	};

	/** Opens the build review for an analytics repurpose handoff, keeping its evidence private. */
	beginRepurposeReview = (handoff: RepurposeHandoff, content: string) => {
		this.repurposePrivateContextNotes = repurposePrivateContext(handoff);
		this.aiContextNotes = '';
		this.aiContextURLs = '';
		this.aiContextMayPublish = false;
		this.aiObjective = m.compose_ai_repurpose_objective();
		this.aiGenerationIdea = content;
		this.aiAngles = [
			{
				id: `repurpose-${handoff.handoff_id}`,
				label: m.compose_ai_repurpose_direction(),
				hook: handoff.title || content.slice(0, 160),
				thesis: m.compose_ai_repurpose_thesis(),
				approach: m.compose_ai_repurpose_approach(),
				objective: m.compose_ai_repurpose_objective(),
				desired_reaction: m.compose_ai_repurpose_reaction(),
				evidence: '',
				media: { treatment: 'none', role: 'none', brief: '' },
				build_direction: { outcome: m.compose_ai_repurpose_objective() }
			}
		];
		this.aiSelectedAngleID = this.aiAngles[0].id;
		this.aiWorkspaceEntry = 'build';
		this.aiWorkspaceStep = 'angles';
		this.repurposeReviewActive = true;
		this.aiWorkspaceOpen = true;
	};

	/** Stops AI work and clears generation state that belongs to the previous Workspace. */
	resetForWorkspaceChange = () => {
		this.aiRequestController?.abort();
		this.aiVoiceRequestController?.abort();
		if (this.aiPollTimer) clearTimeout(this.aiPollTimer);
		this.aiPollTimer = null;
		if (this.aiOpportunitySlowTimer) clearTimeout(this.aiOpportunitySlowTimer);
		this.aiOpportunitySlowTimer = null;
		this.aiOpportunitySlow = false;
		this.aiMemeRequestGeneration += 1;
		this.buildingPost = false;
		this.aiOpportunityLoading = false;
		this.aiFindingMore = false;
		this.aiWorkspaceOpen = false;
		this.aiActiveBuild = null;
		this.aiPendingResult = null;
		this.aiAppliedResult = null;
		this.aiAppliedStrategies = [];
		this.aiAttachmentRequirements = {};
		this.aiApplyPending = false;
		this.aiBuildCreateRejected = false;
		this.aiBuildPublicationID = '';
		this.aiVoiceName = m.compose_ai_default_voice();
		this.aiVoiceProfileID = '';
		this.aiMemeCandidates = [];
		this.aiMemeTargetAccountIDs = [];
		this.aiMemeWorkspaceID = '';
		this.aiMemeError = '';
		this.generationUndo = null;
		this.latestGenerationUndo = null;
		this.postBuilderError = '';
	};

	/** Releases timers, requests, and the shared builder's apply callback when the composer unmounts. */
	dispose = () => {
		if (ideate.entry?.apply === this.modalApply && ideate.entry)
			ideate.entry = { ...ideate.entry, apply: undefined };
		if (this.aiPollTimer) clearTimeout(this.aiPollTimer);
		if (this.aiOpportunitySlowTimer) clearTimeout(this.aiOpportunitySlowTimer);
		this.aiRequestController?.abort();
		this.aiVoiceRequestController?.abort();
	};

	constructor(host: AIBuilderHost) {
		this.host = host;
	}
}
