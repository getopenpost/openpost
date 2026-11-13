<script lang="ts" module>
	export interface CollectionIssue {
		key: string;
		name: string;
		platform: string;
		avatarUrl?: string | null;
		/** What happened, or what the owner should do. */
		title: string;
		/** Optional provider detail in muted text. */
		detail?: string;
		action?: {
			label: string;
			href?: string;
			onclick?: () => void;
			disabled?: boolean;
		};
	}
</script>

<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';

	let { issues, description }: { issues: CollectionIssue[]; description: string } = $props();
</script>

<!-- One quiet entry point for per-account collection problems, so Inbox pages
     never stack a banner per account above the content they describe. -->
{#if issues.length > 0}
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" data-testid="inbox-collection-issues">
					<ProtectedIcon icon="error" class="size-4 text-amber-600 dark:text-amber-400" />
					{m.engagement_collection_issues({ count: issues.length })}
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="end" class="w-96 max-w-[calc(100vw-1rem)] overflow-hidden p-0">
			<div class="border-b px-4 py-3">
				<p class="text-sm font-semibold">{m.engagement_collection_issues_title()}</p>
				<p class="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
			</div>
			<ul class="max-h-80 divide-y overflow-y-auto">
				{#each issues as issue (issue.key)}
					<li class="px-4 py-3">
						<SocialAccountIdentity
							name={issue.name}
							platform={issue.platform}
							avatarUrl={issue.avatarUrl}
						/>
						<div class="mt-2 ps-11">
							<p class="text-xs font-medium text-foreground">{issue.title}</p>
							{#if issue.detail}
								<p class="mt-1 text-xs leading-5 text-muted-foreground">{issue.detail}</p>
							{/if}
							{#if issue.action}
								<Button
									href={issue.action.href}
									onclick={issue.action.onclick}
									disabled={issue.action.disabled}
									variant="link"
									size="sm"
									class="mt-1 h-auto min-h-8 px-0"
								>
									{issue.action.label}
								</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</Popover.Content>
	</Popover.Root>
{/if}
