<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import StarIcon from '@lucide/svelte/icons/star';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import type {
		VoiceProfile,
		VoiceProfileDefinition,
		VoiceProfileDraft,
		VoiceProfilesCopy
	} from '$lib/voice-profiles';
	import MultiValueField from './multi-value-field.svelte';
	import VoiceLearningEditor from './voice-learning-editor.svelte';

	interface Props {
		draft: VoiceProfileDraft;
		profile?: VoiceProfile | null;
		copy: VoiceProfilesCopy;
		dirty?: boolean;
		saving?: boolean;
		settingDefault?: boolean;
		disabled?: boolean;
		onChange: (draft: VoiceProfileDraft) => void;
		onSave: () => void;
		onCancel: () => void;
		onSetDefault: () => void;
		onDelete: () => void;
	}

	let {
		draft,
		profile = null,
		copy,
		dirty = false,
		saving = false,
		settingDefault = false,
		disabled = false,
		onChange,
		onSave,
		onCancel,
		onSetDefault,
		onDelete
	}: Props = $props();

	let advancedOpen = $state(false);
	const busy = $derived(disabled || saving || settingDefault);

	function changeDefinition(patch: Partial<VoiceProfileDefinition>): void {
		onChange({ ...draft, definition: { ...draft.definition, ...patch } });
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		onSave();
	}
</script>

<section
	class="overflow-hidden rounded-lg border bg-card"
	aria-labelledby="voice-profile-editor-heading"
>
	<div class="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				<h2 id="voice-profile-editor-heading" class="truncate text-base font-semibold">
					{profile ? profile.name : copy.newProfile}
				</h2>
				{#if profile?.isDefault}<Badge class="shadow-none">{copy.defaultBadge}</Badge>{/if}
			</div>
			{#if profile?.isDefault}
				<p class="mt-1 text-xs leading-5 text-muted-foreground">{copy.defaultHelp}</p>
			{/if}
		</div>
		{#if profile}
			<div class="flex shrink-0 flex-wrap gap-2">
				{#if !profile.isDefault}
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy || dirty}
						onclick={onSetDefault}
					>
						{#if settingDefault}<LoaderIcon
								class="size-3.5 animate-spin motion-reduce:animate-none"
							/>{:else}<StarIcon class="size-3.5" />{/if}
						{settingDefault ? copy.settingDefault : copy.setDefault}
					</Button>
				{/if}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="text-destructive hover:text-destructive"
					disabled={busy || profile.isDefault}
					title={profile.isDefault ? copy.deleteDefaultHelp : undefined}
					onclick={onDelete}
				>
					<TrashIcon class="size-3.5" />{copy.delete}
				</Button>
			</div>
		{/if}
	</div>

	<form onsubmit={submit}>
		<div class="space-y-6 p-4">
			<div class="max-w-md space-y-2">
				<Label for="voice-profile-name">{copy.name}</Label>
				<Input
					id="voice-profile-name"
					value={draft.name}
					placeholder={copy.namePlaceholder}
					maxlength={80}
					required
					disabled={busy}
					oninput={(event) => onChange({ ...draft, name: event.currentTarget.value })}
				/>
			</div>

			<section class="space-y-4" aria-labelledby="voice-identity-heading">
				<div>
					<h3 id="voice-identity-heading" class="text-sm font-semibold">{copy.identityHeading}</h3>
					<p class="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
						{copy.identityDescription}
					</p>
				</div>
				<div class="space-y-2">
					<Label for="voice-identity-summary">{copy.identitySummary}</Label>
					<Textarea
						id="voice-identity-summary"
						value={draft.definition.identitySummary}
						placeholder={copy.identitySummaryPlaceholder}
						maxlength={1200}
						disabled={busy}
						oninput={(event) => changeDefinition({ identitySummary: event.currentTarget.value })}
					/>
				</div>
				<div class="grid gap-4 md:grid-cols-2">
					<MultiValueField
						id="voice-traits"
						label={copy.traits}
						description={copy.traitsDescription}
						value={draft.definition.traits}
						placeholder={copy.traitsPlaceholder}
						addLabel={copy.addItem}
						removeLabel={copy.removeItem}
						disabled={busy}
						onChange={(traits) => changeDefinition({ traits })}
					/>
					<MultiValueField
						id="voice-expertise"
						label={copy.expertise}
						description={copy.expertiseDescription}
						value={draft.definition.expertise}
						placeholder={copy.expertisePlaceholder}
						addLabel={copy.addItem}
						removeLabel={copy.removeItem}
						disabled={busy}
						onChange={(expertise) => changeDefinition({ expertise })}
					/>
				</div>
			</section>

			<Collapsible.Root bind:open={advancedOpen} class="overflow-hidden rounded-lg border">
				<Collapsible.Trigger
					class="group flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
				>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-medium">{copy.advancedHeading}</span>
						<span class="mt-0.5 block text-xs leading-5 text-muted-foreground"
							>{copy.advancedDescription}</span
						>
					</span>
					<ChevronDownIcon
						class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
					/>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div class="space-y-7 border-t bg-muted/10 p-4">
						<section class="space-y-4" aria-labelledby="voice-language-heading">
							<h3 id="voice-language-heading" class="text-sm font-semibold">
								{copy.languageHeading}
							</h3>
							<div class="grid gap-4 md:grid-cols-2">
								<MultiValueField
									id="voice-vocabulary"
									label={copy.vocabulary}
									description={copy.vocabularyDescription}
									value={draft.definition.vocabulary}
									placeholder={copy.vocabularyPlaceholder}
									addLabel={copy.addItem}
									removeLabel={copy.removeItem}
									disabled={busy}
									onChange={(vocabulary) => changeDefinition({ vocabulary })}
								/>
								<MultiValueField
									id="voice-expressions"
									label={copy.recurringExpressions}
									description={copy.recurringExpressionsDescription}
									value={draft.definition.recurringExpressions}
									placeholder={copy.recurringExpressionsPlaceholder}
									addLabel={copy.addItem}
									removeLabel={copy.removeItem}
									disabled={busy}
									onChange={(recurringExpressions) => changeDefinition({ recurringExpressions })}
								/>
							</div>
							<MultiValueField
								id="voice-opinions"
								label={copy.opinions}
								description={copy.opinionsDescription}
								value={draft.definition.opinions}
								placeholder={copy.opinionsPlaceholder}
								addLabel={copy.addItem}
								removeLabel={copy.removeItem}
								maxLength={600}
								disabled={busy}
								onChange={(opinions) => changeDefinition({ opinions })}
							/>
						</section>

						<section class="space-y-4 border-t pt-6" aria-labelledby="voice-tone-heading">
							<h3 id="voice-tone-heading" class="text-sm font-semibold">{copy.toneHeading}</h3>
							<div class="grid gap-4 md:grid-cols-2">
								<div class="space-y-2">
									<Label for="voice-humor">{copy.humor}</Label>
									<Textarea
										id="voice-humor"
										value={draft.definition.humor}
										placeholder={copy.humorPlaceholder}
										maxlength={400}
										disabled={busy}
										oninput={(event) => changeDefinition({ humor: event.currentTarget.value })}
									/>
								</div>
								<div class="space-y-2">
									<Label for="voice-formality">{copy.formality}</Label>
									<Textarea
										id="voice-formality"
										value={draft.definition.formality}
										placeholder={copy.formalityPlaceholder}
										maxlength={400}
										disabled={busy}
										oninput={(event) => changeDefinition({ formality: event.currentTarget.value })}
									/>
								</div>
							</div>
							<MultiValueField
								id="voice-boundaries"
								label={copy.boundaries}
								description={copy.boundariesDescription}
								value={draft.definition.boundaries}
								placeholder={copy.boundariesPlaceholder}
								addLabel={copy.addItem}
								removeLabel={copy.removeItem}
								maxLength={400}
								disabled={busy}
								onChange={(boundaries) => changeDefinition({ boundaries })}
							/>
						</section>

						<section class="space-y-4 border-t pt-6" aria-labelledby="voice-avoid-heading">
							<h3 id="voice-avoid-heading" class="text-sm font-semibold">{copy.avoidHeading}</h3>
							<div class="grid gap-4 md:grid-cols-2">
								<MultiValueField
									id="voice-forbidden"
									label={copy.forbiddenPhrases}
									description={copy.forbiddenPhrasesDescription}
									value={draft.definition.forbiddenPhrases}
									placeholder={copy.forbiddenPhrasesPlaceholder}
									addLabel={copy.addItem}
									removeLabel={copy.removeItem}
									disabled={busy}
									onChange={(forbiddenPhrases) => changeDefinition({ forbiddenPhrases })}
								/>
								<MultiValueField
									id="voice-patterns"
									label={copy.dislikedPatterns}
									description={copy.dislikedPatternsDescription}
									value={draft.definition.dislikedPatterns}
									placeholder={copy.dislikedPatternsPlaceholder}
									addLabel={copy.addItem}
									removeLabel={copy.removeItem}
									maxLength={400}
									disabled={busy}
									onChange={(dislikedPatterns) => changeDefinition({ dislikedPatterns })}
								/>
							</div>
						</section>

						<section class="space-y-4 border-t pt-6" aria-labelledby="voice-learning-heading">
							<div>
								<h3 id="voice-learning-heading" class="text-sm font-semibold">
									{copy.learningHeading}
								</h3>
								<p class="mt-1 text-xs leading-5 text-muted-foreground">
									{copy.learningDescription}
								</p>
							</div>
							<VoiceLearningEditor
								examples={draft.definition.examples}
								corrections={draft.definition.corrections}
								interviewAnswers={draft.definition.interviewAnswers}
								{copy}
								disabled={busy}
								onExamplesChange={(examples) => changeDefinition({ examples })}
								onCorrectionsChange={(corrections) => changeDefinition({ corrections })}
								onInterviewAnswersChange={(interviewAnswers) =>
									changeDefinition({ interviewAnswers })}
							/>
						</section>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>

		<footer class="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
			<Button
				type="button"
				variant="outline"
				disabled={busy || (!dirty && Boolean(profile))}
				onclick={onCancel}>{copy.cancel}</Button
			>
			<Button type="submit" disabled={busy || !dirty || !draft.name.trim()}>
				{#if saving}<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />{/if}
				{saving ? copy.saving : profile ? copy.save : copy.create}
			</Button>
		</footer>
	</form>
</section>
