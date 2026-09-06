<script lang="ts">
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';

	type RepostRule = components['schemas']['Rule'];
	type RepostStage = components['schemas']['Stage'];
	const maximumWindowSeconds = 2592000;

	interface Props {
		rule: RepostRule;
		idPrefix: string;
		disabled?: boolean;
		onChange?: () => void;
	}

	let { rule = $bindable(), idPrefix, disabled = false, onChange }: Props = $props();

	const delayOptions = [
		{ value: 0, label: m.repost_delay_immediately() },
		{ value: 900, label: m.repost_delay_minutes({ count: 15 }) },
		{ value: 3600, label: m.repost_delay_hours({ count: 1 }) },
		{ value: 10800, label: m.repost_delay_hours({ count: 3 }) },
		{ value: 21600, label: m.repost_delay_hours({ count: 6 }) },
		{ value: 43200, label: m.repost_delay_hours({ count: 12 }) },
		{ value: 86400, label: m.repost_delay_days({ count: 1 }) },
		{ value: 172800, label: m.repost_delay_days({ count: 2 }) },
		{ value: 259200, label: m.repost_delay_days({ count: 3 }) },
		{ value: 604800, label: m.repost_delay_days({ count: 7 }) },
		{ value: 1209600, label: m.repost_delay_days({ count: 14 }) },
		{ value: 2592000, label: m.repost_delay_days({ count: 30 }) }
	];

	const stages = $derived(normalizedStages(rule));
	const nextDelay = $derived(
		delayOptions.find(
			(option) =>
				option.value > stages[stages.length - 1].delay_seconds &&
				option.value < maximumWindowSeconds
		)?.value
	);

	function normalizedStages(value: RepostRule): RepostStage[] {
		if (value.stages?.length) return value.stages;
		return [{ delay_seconds: value.delay_seconds, unrepost_previous: false }];
	}

	function updateStage(index: number, update: Partial<RepostStage>) {
		const next = normalizedStages(rule).map((stage) => ({ ...stage }));
		next[index] = { ...next[index], ...update };
		if (index === 0) {
			next[0].unrepost_previous = false;
			rule.delay_seconds = next[0].delay_seconds;
		}
		rule.stages = next;
		const lastDelay = next[next.length - 1].delay_seconds;
		if (rule.evaluation_window_seconds <= lastDelay) {
			rule.evaluation_window_seconds =
				delayOptions.find((option) => option.value > lastDelay)?.value ?? maximumWindowSeconds;
		}
		onChange?.();
	}

	function addStage() {
		if (nextDelay === undefined) return;
		rule.stages = [
			...normalizedStages(rule).map((stage) => ({ ...stage })),
			{ delay_seconds: nextDelay, unrepost_previous: true }
		];
		if (rule.evaluation_window_seconds <= nextDelay) {
			rule.evaluation_window_seconds =
				delayOptions.find((option) => option.value > nextDelay)?.value ?? maximumWindowSeconds;
		}
		onChange?.();
	}

	function removeStage(index: number) {
		const next = normalizedStages(rule).filter((_, stageIndex) => stageIndex !== index);
		next[0].unrepost_previous = false;
		rule.stages = next;
		rule.delay_seconds = next[0].delay_seconds;
		onChange?.();
	}

	function delayLabel(seconds: number) {
		return (
			delayOptions.find((option) => option.value === seconds)?.label ?? m.repost_custom_delay()
		);
	}
</script>

<fieldset class="space-y-3">
	<legend class="text-sm font-medium">{m.repost_schedule()}</legend>
	<p class="text-sm text-muted-foreground">{m.repost_schedule_body()}</p>
	<div class="space-y-3">
		{#each stages as stage, index (`${index}-${stage.delay_seconds}`)}
			<div class="rounded-lg border bg-muted/10 p-3">
				<div class="flex items-center justify-between gap-3">
					<Label for={`${idPrefix}-stage-${index}`}>{m.repost_stage({ count: index + 1 })}</Label>
					{#if stages.length > 1}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="size-11 text-muted-foreground hover:text-destructive"
							{disabled}
							aria-label={m.repost_remove_stage({ count: index + 1 })}
							onclick={() => removeStage(index)}
						>
							<ThemeIcon role="delete" class="size-4" />
						</Button>
					{/if}
				</div>
				<Select.Root
					type="single"
					value={String(stage.delay_seconds)}
					{disabled}
					onValueChange={(value) => updateStage(index, { delay_seconds: Number(value) })}
				>
					<Select.Trigger id={`${idPrefix}-stage-${index}`} class="mt-2 min-h-11 w-full">
						{delayLabel(stage.delay_seconds)}
					</Select.Trigger>
					<Select.Content>
						{#each delayOptions as option (option.value)}
							<Select.Item
								value={String(option.value)}
								disabled={option.value >= maximumWindowSeconds ||
									(index > 0 && option.value <= stages[index - 1].delay_seconds) ||
									(index < stages.length - 1 && option.value >= stages[index + 1].delay_seconds)}
							>
								{option.label}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if index > 0}
					<label class="mt-3 flex min-h-11 items-center gap-3 text-sm">
						<Checkbox
							checked={stage.unrepost_previous}
							{disabled}
							onCheckedChange={(checked) => updateStage(index, { unrepost_previous: checked })}
						/>
						<span>{m.repost_unrepost_previous()}</span>
					</label>
				{/if}
			</div>
		{/each}
	</div>
	<Button
		type="button"
		variant="outline"
		size="sm"
		class="min-h-11"
		disabled={disabled || nextDelay === undefined}
		onclick={addStage}
	>
		<ThemeIcon role="add" class="size-4" />
		{m.repost_add_stage()}
	</Button>
</fieldset>
