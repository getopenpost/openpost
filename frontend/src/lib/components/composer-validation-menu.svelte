<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import CircleAlertIcon from 'lucide-svelte/icons/circle-alert';
	import TriangleAlertIcon from 'lucide-svelte/icons/triangle-alert';
	import type { ComposerIssue } from './compose/validation';

	interface Props {
		issues: ComposerIssue[];
		class?: string;
	}

	let { issues, class: className = '' }: Props = $props();
	const hasErrors = $derived(issues.some((issue) => issue.severity === 'error'));
</script>

{#if issues.length > 0}
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="ghost"
					size="icon"
					class={cn(
						'size-11 shrink-0 sm:size-9',
						hasErrors
							? 'text-destructive hover:text-destructive'
							: 'text-amber-700 hover:text-amber-700 dark:text-amber-300',
						className
					)}
					aria-label={`${m.compose_check_before_publishing()} (${issues.length})`}
					data-testid="composer-validation-control"
				>
					{#if hasErrors}
						<CircleAlertIcon class="size-4" />
					{:else}
						<TriangleAlertIcon class="size-4" />
					{/if}
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-80 max-w-[calc(100vw-1rem)] p-0" align="start">
			<div class="border-b px-3 py-2.5">
				<p class="text-sm font-medium">{m.compose_check_before_publishing()}</p>
				<p class="text-xs text-muted-foreground">
					{m.compose_issue_count({ count: issues.length })}
				</p>
			</div>
			<ul class="max-h-72 space-y-1 overflow-y-auto p-2">
				{#each issues as issue (issue.id)}
					<li
						class={cn(
							'flex gap-2 rounded-md px-2 py-2 text-sm leading-5',
							issue.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'
						)}
					>
						{#if issue.severity === 'error'}
							<CircleAlertIcon class="mt-0.5 size-4 shrink-0" />
						{:else}
							<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
						{/if}
						<span>{issue.message}</span>
					</li>
				{/each}
			</ul>
		</Popover.Content>
	</Popover.Root>
{/if}
