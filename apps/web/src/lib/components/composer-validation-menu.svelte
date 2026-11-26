<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { ThemeIcon } from '$lib/themes/icons';
	import { isTextLimitIssue, type ComposerIssue } from './compose/validation';

	interface Props {
		issues: ComposerIssue[];
		class?: string;
		onSelect?: (issue: ComposerIssue) => void;
		onShorten?: (issue: ComposerIssue) => void | Promise<void>;
		shorteningIssueId?: string | null;
	}

	let {
		issues,
		class: className = '',
		onSelect,
		onShorten,
		shorteningIssueId = null
	}: Props = $props();
	let open = $state(false);
	let selectingIssue = $state(false);
	const hasErrors = $derived(issues.some((issue) => issue.severity === 'error'));

	function hasTarget(issue: ComposerIssue): boolean {
		return Boolean(
			issue.accountId || issue.segmentId || issue.scopeId || issue.field || issue.mediaId
		);
	}

	function selectIssue(issue: ComposerIssue) {
		selectingIssue = true;
		open = false;
		onSelect?.(issue);
	}
</script>

{#if issues.length > 0}
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="ghost"
					size="sm"
					class={cn(
						'min-h-9 max-w-full shrink-0 gap-1.5 [@media(pointer:coarse)]:min-h-11',
						hasErrors
							? 'text-action-destructive-foreground hover:text-action-destructive-foreground'
							: 'text-warning-foreground hover:text-warning-foreground',
						className
					)}
					aria-label={`${m.compose_check_before_publishing()} (${issues.length})`}
					data-testid="composer-validation-control"
				>
					<ProtectedIcon icon="warning" class="size-4 shrink-0" />
					<span>{m.compose_issue_count({ count: issues.length })}</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content
			onCloseAutoFocus={(event) => {
				if (selectingIssue) {
					event.preventDefault();
					selectingIssue = false;
				}
			}}
			class="w-80 max-w-[calc(100vw-1rem)] p-0"
			align="start"
		>
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
							'rounded-md text-sm leading-5',
							issue.severity === 'error'
								? 'text-action-destructive-foreground'
								: 'text-warning-foreground'
						)}
					>
						{#snippet issueContent()}
							{#if issue.severity === 'error'}
								<ProtectedIcon icon="error" class="mt-0.5 size-4 shrink-0" />
							{:else}
								<ProtectedIcon icon="warning" class="mt-0.5 size-4 shrink-0" />
							{/if}
							<span class="min-w-0 flex-1">
								{#if issue.targetLabel}
									<span class="block text-xs font-semibold">{issue.targetLabel}</span>
								{/if}
								<span class="block">{issue.message}</span>
								{#if issue.mediaId && onSelect}<span
										class="mt-1 block text-xs font-medium underline underline-offset-2"
										>{m.compose_edit_media()}</span
									>{/if}
							</span>
						{/snippet}
						{#if onSelect && hasTarget(issue)}
							<button
								type="button"
								class="flex min-h-11 w-full gap-2 rounded-md px-2 py-2 text-start hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								onclick={() => selectIssue(issue)}
								aria-label={`${m.common_edit()}: ${issue.targetLabel ? `${issue.targetLabel}: ` : ''}${issue.message}`}
							>
								{@render issueContent()}
							</button>
						{:else}
							<div class="flex gap-2 px-2 py-2">{@render issueContent()}</div>
						{/if}
						{#if onShorten && isTextLimitIssue(issue)}
							<div class="px-2 pb-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									class="min-h-11 md:min-h-8"
									disabled={shorteningIssueId !== null}
									aria-busy={shorteningIssueId === issue.id}
									onclick={() => void onShorten(issue)}
								>
									<ThemeIcon role="sparkles" class="size-3.5" />
									{shorteningIssueId === issue.id
										? m.compose_shortening()
										: m.compose_shorten_with_ai()}
								</Button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</Popover.Content>
	</Popover.Root>
{/if}
