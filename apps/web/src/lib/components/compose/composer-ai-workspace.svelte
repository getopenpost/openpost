<script lang="ts">
	import type { SocialAccount } from '$lib/api/client';
	import AIWorkspaceDialog from '$lib/components/post-builder/ai-workspace-dialog.svelte';
	import PostOptions from '$lib/components/post-builder/post-options.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { m } from '$lib/paraglide/messages';
	import Disclosure from '../disclosure.svelte';
	import type { ComposerAIBuilder } from './ai-builder.svelte';

	// The AI workspace dialog and the review for dropping a destination's media requirement.
	let {
		ai,
		accounts,
		workspaceId
	}: { ai: ComposerAIBuilder; accounts: SocialAccount[]; workspaceId: string } = $props();
</script>

<AIWorkspaceDialog
	bind:open={ai.aiWorkspaceOpen}
	entry={ai.aiWorkspaceEntry}
	step={ai.aiWorkspaceStep}
	copy={ai.repurposeReviewActive
		? ai.repurposeWorkspaceCopy
		: { ...ai.aiWorkspaceCopy, getIdeas: m.ideate_generate() }}
	opportunities={ai.aiWorkspaceOpportunities}
	selectedOpportunityId={ai.aiSelectedOpportunityID}
	angles={ai.aiWorkspaceAngles}
	selectedAngleId={ai.aiSelectedAngleID}
	generationPhases={ai.aiGenerationPhases}
	generationMessage={ai.aiGenerationMessage}
	destinationSummary={accounts.length === 1
		? m.compose_ai_destination_summary_one({ count: accounts.length })
		: m.compose_ai_destination_summary_many({ count: accounts.length })}
	voiceSummary={m.compose_ai_writing_as({ voice: ai.aiVoiceName })}
	loadingOpportunities={ai.aiOpportunityLoading}
	opportunityLoadingMessage={ai.aiOpportunitySlow
		? m.compose_ai_finding_ideas_slow()
		: m.compose_ai_finding_ideas()}
	findingMore={ai.aiFindingMore}
	generating={ai.buildingPost}
	generationActive={ai.aiGenerationActive}
	cancelling={ai.aiCancelling}
	canCancel={ai.aiActiveBuild?.state === 'queued' || ai.aiActiveBuild?.state === 'building'}
	applyPending={ai.aiApplyPending}
	error={ai.postBuilderError}
	onSelectOpportunity={ai.selectPublicationOpportunity}
	onSelectAngle={(angle) => {
		ai.aiSelectedAngleID = angle.id;
		const selected = ai.aiAngles.find((candidate) => candidate.id === angle.id);
		if (selected) ai.aiObjective = selected.objective;
	}}
	onDiscover={() => void ai.startSelectedPublicationBuild()}
	onContinue={() => void ai.continuePublicationOpportunity()}
	onFindMore={() => void ai.loadPublicationOpportunities(true)}
	onBack={ai.aiWorkspaceEntry === 'ideate'
		? () => {
				ai.postBuilderError = '';
				ai.aiWorkspaceStep = 'opportunities';
				ai.aiAngles = [];
				ai.aiSelectedAngleID = '';
			}
		: undefined}
	onBuild={() => void ai.startSelectedPublicationBuild()}
	onCancel={() => void ai.cancelActivePublicationBuild()}
	onRetry={ai.aiActiveBuild?.state === 'failed'
		? () => void ai.retryActivePublicationBuild()
		: ai.aiBuildCreateRejected
			? undefined
			: ai.aiWorkspaceStep === 'opportunities'
				? () => void ai.loadPublicationOpportunities()
				: () => void ai.loadPublicationAngles(ai.aiGenerationIdea)}
	onApply={() => ai.applyReadyPublicationBuild()}
	onKeepEditing={ai.keepCurrentComposerEdits}
	onDismissError={() => (ai.postBuilderError = '')}
>
	{#snippet context()}
		{#if ai.aiWorkspaceStep === 'brief'}
			<label class="mx-auto grid max-w-2xl gap-2 text-sm font-medium">
				{m.compose_ai_brief()}
				<Textarea
					bind:value={ai.aiIdeationBrief}
					maxlength={20000}
					rows={5}
					placeholder={m.compose_ai_brief_placeholder()}
				/>
			</label>
			<Button
				type="button"
				variant="ghost"
				class="mt-2"
				onclick={() => void ai.discoverPublicationIdeas()}
				disabled={ai.buildingPost}>{m.compose_ai_ideate()}</Button
			>
		{:else if ai.aiWorkspaceStep === 'angles'}
			<div class="grid gap-3 rounded-lg border bg-muted/25 p-3 sm:grid-cols-2">
				<label class="grid gap-1.5 text-xs font-medium">
					{m.compose_ai_context_objective()}
					<Input
						bind:value={ai.aiObjective}
						maxlength={200}
						placeholder={m.compose_ai_context_objective_placeholder()}
					/>
				</label>
				<label class="grid gap-1.5 text-xs font-medium">
					{m.compose_ai_context_change()}
					<Input
						bind:value={ai.aiChangeRequest}
						maxlength={500}
						placeholder={m.compose_ai_context_change_placeholder()}
					/>
				</label>
				<Disclosure
					summary={m.compose_ai_context_add()}
					summaryClass="text-xs text-muted-foreground"
					class="sm:col-span-2"
				>
					<div class="mt-2 grid gap-3 sm:grid-cols-2">
						<label class="grid gap-1.5 text-xs font-medium">
							{m.compose_ai_context_notes()}
							<Textarea
								bind:value={ai.aiContextNotes}
								maxlength={10000}
								rows={3}
								placeholder={m.compose_ai_context_notes_placeholder()}
							/>
						</label>
						<label class="grid gap-1.5 text-xs font-medium">
							{m.compose_ai_context_links()}
							<Textarea
								bind:value={ai.aiContextURLs}
								rows={3}
								placeholder={m.compose_ai_context_links_placeholder()}
							/>
						</label>
						<label class="flex min-h-11 items-center gap-2 text-xs sm:col-span-2">
							<Checkbox
								checked={ai.aiContextMayPublish}
								onCheckedChange={(checked) => (ai.aiContextMayPublish = checked === true)}
							/>
							{m.compose_ai_context_allow_notes()}
						</label>
						{#if ai.selectedAIAssets().length > 0}
							<p class="text-xs text-muted-foreground sm:col-span-2">
								{ai.selectedAIAssets().length === 1
									? m.compose_ai_context_attachment_one({ count: ai.selectedAIAssets().length })
									: m.compose_ai_context_attachment_many({ count: ai.selectedAIAssets().length })}
							</p>
						{/if}
					</div>
				</Disclosure>
			</div>
		{/if}
	{/snippet}
	{#snippet results()}
		<PostOptions
			sources={ai.aiPendingResult?.sources ?? []}
			options={ai.aiPostOptions}
			{accounts}
			{workspaceId}
			busy={ai.buildingPost}
			onUse={(option) => void ai.useAIPostOption(option)}
			onChange={(option) =>
				(ai.aiPostOptions = ai.aiPostOptions.map((item) =>
					item.id === option.id ? option : item
				))}
		/>
	{/snippet}
</AIWorkspaceDialog>

<Dialog.Root
	open={!!ai.requirementReviewId}
	onOpenChange={(open) => {
		if (!open) ai.requirementReviewId = '';
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header
			><Dialog.Title>{m.ideate_review_without_media()}</Dialog.Title><Dialog.Description
				>{m.ideate_review_without_media_description()}</Dialog.Description
			></Dialog.Header
		>
		<label class="grid gap-2 text-sm font-medium"
			>{m.ideate_post_text()}<Textarea bind:value={ai.requirementReviewText} rows={5} /></label
		>
		<Dialog.Footer
			><Button variant="outline" onclick={() => (ai.requirementReviewId = '')}
				>{m.common_cancel()}</Button
			><Button disabled={!ai.requirementReviewText.trim()} onclick={ai.saveRequirementWithoutMedia}
				>{m.ideate_save_without_media()}</Button
			></Dialog.Footer
		>
	</Dialog.Content>
</Dialog.Root>
