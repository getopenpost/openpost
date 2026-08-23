<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import type {
		VoiceProfileCorrection,
		VoiceProfileExample,
		VoiceProfileInterviewAnswer,
		VoiceProfilesCopy
	} from '$lib/voice-profiles';

	interface Props {
		examples: VoiceProfileExample[];
		corrections: VoiceProfileCorrection[];
		interviewAnswers: VoiceProfileInterviewAnswer[];
		copy: VoiceProfilesCopy;
		disabled?: boolean;
		onExamplesChange: (value: VoiceProfileExample[]) => void;
		onCorrectionsChange: (value: VoiceProfileCorrection[]) => void;
		onInterviewAnswersChange: (value: VoiceProfileInterviewAnswer[]) => void;
	}

	let {
		examples,
		corrections,
		interviewAnswers,
		copy,
		disabled = false,
		onExamplesChange,
		onCorrectionsChange,
		onInterviewAnswersChange
	}: Props = $props();

	function changeExample(index: number, patch: Partial<VoiceProfileExample>): void {
		onExamplesChange(
			examples.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
		);
	}

	function changeCorrection(index: number, patch: Partial<VoiceProfileCorrection>): void {
		onCorrectionsChange(
			corrections.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
		);
	}

	function changeInterview(index: number, patch: Partial<VoiceProfileInterviewAnswer>): void {
		onInterviewAnswersChange(
			interviewAnswers.map((item, itemIndex) =>
				itemIndex === index ? { ...item, ...patch } : item
			)
		);
	}
</script>

<div class="divide-y rounded-lg border">
	<section class="space-y-3 p-4" aria-labelledby="voice-examples-heading">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h4 id="voice-examples-heading" class="text-sm font-medium">{copy.examples}</h4>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled || examples.length >= 20}
				onclick={() => onExamplesChange([...examples, { text: '' }])}
			>
				<PlusIcon class="size-3.5" />{copy.addExample}
			</Button>
		</div>
		{#each examples as example, index}
			<div class="grid gap-3 border-t pt-3 sm:grid-cols-2">
				<div class="space-y-2 sm:col-span-2">
					<Label for={`voice-example-${index}`}>{copy.exampleText}</Label>
					<Textarea
						id={`voice-example-${index}`}
						value={example.text}
						placeholder={copy.exampleTextPlaceholder}
						maxlength={4000}
						{disabled}
						oninput={(event) => changeExample(index, { text: event.currentTarget.value })}
					/>
				</div>
				<div class="space-y-2">
					<Label for={`voice-example-platform-${index}`}>{copy.examplePlatform}</Label>
					<Input
						id={`voice-example-platform-${index}`}
						value={example.platform ?? ''}
						placeholder={copy.examplePlatformPlaceholder}
						maxlength={80}
						{disabled}
						oninput={(event) => changeExample(index, { platform: event.currentTarget.value })}
					/>
				</div>
				<div class="space-y-2">
					<Label for={`voice-example-reason-${index}`}>{copy.exampleReason}</Label>
					<Input
						id={`voice-example-reason-${index}`}
						value={example.whyItFits ?? ''}
						placeholder={copy.exampleReasonPlaceholder}
						maxlength={500}
						{disabled}
						oninput={(event) => changeExample(index, { whyItFits: event.currentTarget.value })}
					/>
				</div>
				<div class="sm:col-span-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-destructive hover:text-destructive"
						{disabled}
						onclick={() => onExamplesChange(examples.filter((_, itemIndex) => itemIndex !== index))}
					>
						<TrashIcon class="size-3.5" />{copy.removeItem}
					</Button>
				</div>
			</div>
		{/each}
	</section>

	<section class="space-y-3 p-4" aria-labelledby="voice-corrections-heading">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h4 id="voice-corrections-heading" class="text-sm font-medium">{copy.corrections}</h4>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled || corrections.length >= 20}
				onclick={() => onCorrectionsChange([...corrections, { original: '', preferred: '' }])}
			>
				<PlusIcon class="size-3.5" />{copy.addCorrection}
			</Button>
		</div>
		{#each corrections as correction, index}
			<div class="grid gap-3 border-t pt-3 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for={`voice-correction-original-${index}`}>{copy.correctionOriginal}</Label>
					<Textarea
						id={`voice-correction-original-${index}`}
						value={correction.original}
						placeholder={copy.correctionOriginalPlaceholder}
						maxlength={3000}
						{disabled}
						oninput={(event) => changeCorrection(index, { original: event.currentTarget.value })}
					/>
				</div>
				<div class="space-y-2">
					<Label for={`voice-correction-preferred-${index}`}>{copy.correctionPreferred}</Label>
					<Textarea
						id={`voice-correction-preferred-${index}`}
						value={correction.preferred}
						placeholder={copy.correctionPreferredPlaceholder}
						maxlength={3000}
						{disabled}
						oninput={(event) => changeCorrection(index, { preferred: event.currentTarget.value })}
					/>
				</div>
				<div class="space-y-2 sm:col-span-2">
					<Label for={`voice-correction-lesson-${index}`}>{copy.correctionLesson}</Label>
					<Input
						id={`voice-correction-lesson-${index}`}
						value={correction.lesson ?? ''}
						placeholder={copy.correctionLessonPlaceholder}
						maxlength={600}
						{disabled}
						oninput={(event) => changeCorrection(index, { lesson: event.currentTarget.value })}
					/>
				</div>
				<div class="sm:col-span-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-destructive hover:text-destructive"
						{disabled}
						onclick={() =>
							onCorrectionsChange(corrections.filter((_, itemIndex) => itemIndex !== index))}
					>
						<TrashIcon class="size-3.5" />{copy.removeItem}
					</Button>
				</div>
			</div>
		{/each}
	</section>

	<section class="space-y-3 p-4" aria-labelledby="voice-interview-heading">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h4 id="voice-interview-heading" class="text-sm font-medium">{copy.interviewAnswers}</h4>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled || interviewAnswers.length >= 20}
				onclick={() =>
					onInterviewAnswersChange([...interviewAnswers, { question: '', answer: '' }])}
			>
				<PlusIcon class="size-3.5" />{copy.addInterviewAnswer}
			</Button>
		</div>
		{#each interviewAnswers as answer, index}
			<div class="grid gap-3 border-t pt-3">
				<div class="space-y-2">
					<Label for={`voice-interview-question-${index}`}>{copy.interviewQuestion}</Label>
					<Input
						id={`voice-interview-question-${index}`}
						value={answer.question}
						placeholder={copy.interviewQuestionPlaceholder}
						maxlength={500}
						{disabled}
						oninput={(event) => changeInterview(index, { question: event.currentTarget.value })}
					/>
				</div>
				<div class="space-y-2">
					<Label for={`voice-interview-answer-${index}`}>{copy.interviewAnswer}</Label>
					<Textarea
						id={`voice-interview-answer-${index}`}
						value={answer.answer}
						placeholder={copy.interviewAnswerPlaceholder}
						maxlength={4000}
						{disabled}
						oninput={(event) => changeInterview(index, { answer: event.currentTarget.value })}
					/>
				</div>
				<div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-destructive hover:text-destructive"
						{disabled}
						onclick={() =>
							onInterviewAnswersChange(
								interviewAnswers.filter((_, itemIndex) => itemIndex !== index)
							)}
					>
						<TrashIcon class="size-3.5" />{copy.removeItem}
					</Button>
				</div>
			</div>
		{/each}
	</section>
</div>
