<script lang="ts">
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { ThemeIcon } from '$lib/themes/icons';
	import { cn, getPlatformName } from '$lib/utils';

	/**
	 * One reusable account row for every account picker.
	 *
	 * Selection contract: the owning picker states which of all/subset/none it
	 * supports and how it encodes that choice on the wire. This row only reports
	 * `selected` and calls `onToggle`; it never changes what a picker selects.
	 */
	interface Props {
		/** Account display name, already formatted by the caller (handle, alias, …). */
		name: string;
		/** Raw platform key; the platform name renders through the shared identity. */
		platform: string;
		avatarUrl?: string | null;
		/** Short status line rendered after the platform name (e.g. needs attention). */
		detail?: string;
		selected: boolean;
		disabled?: boolean;
		/** Readiness issues. Linked via aria-describedby, never folded into the name. */
		issues?: string[];
		/** Muted compatibility note rendered under the identity (repost target constraints). */
		constraint?: string;
		/** Whether to show the customized-for-this-post marker. */
		custom?: boolean;
		customLabel?: string;
		onToggle: () => void;
		/** Checkbox placement. SocialSetControl keeps its trailing checkbox. */
		checkboxPosition?: 'start' | 'end';
		class?: string;
		'data-testid'?: string;
	}

	let {
		name,
		platform,
		avatarUrl = '',
		detail = '',
		selected,
		disabled = false,
		issues = [],
		constraint = '',
		custom = false,
		customLabel = '',
		onToggle,
		checkboxPosition = 'start',
		class: className = '',
		'data-testid': testId
	}: Props = $props();

	const fieldId = $props.id();
	const issuesId = `${fieldId}-issues`;
	// The accessible name is the account label alone, independent of issues or
	// custom state. Issues stay readable through aria-describedby.
	const checkboxLabel = $derived(platform ? `${name}, ${getPlatformName(platform)}` : name);
	const describedBy = $derived(issues.length > 0 ? issuesId : undefined);
</script>

<label
	class={cn(
		'flex min-h-12 min-w-0 cursor-pointer items-center gap-3 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50',
		className
	)}
	data-testid={testId}
>
	{#if checkboxPosition === 'start'}
		<Checkbox
			checked={selected}
			{disabled}
			aria-label={checkboxLabel}
			aria-describedby={describedBy}
			onCheckedChange={onToggle}
		/>
	{/if}
	<div class="min-w-0 flex-1">
		<SocialAccountIdentity {name} {platform} {avatarUrl} {detail} />
		{#if issues.length > 0}
			<ul
				id={issuesId}
				class="mt-1 space-y-0.5 pl-10 text-xs leading-snug break-words text-destructive"
			>
				{#each issues as issue (issue)}
					<li>{issue}</li>
				{/each}
			</ul>
		{:else if constraint}
			<p class="mt-1 pl-10 text-xs leading-5 break-words text-muted-foreground">{constraint}</p>
		{/if}
	</div>
	{#if custom}
		<ThemeIcon role="edit" class="size-3.5 shrink-0 text-primary" aria-label={customLabel} />
	{/if}
	{#if checkboxPosition === 'end'}
		<Checkbox
			checked={selected}
			{disabled}
			aria-label={checkboxLabel}
			aria-describedby={describedBy}
			onCheckedChange={onToggle}
		/>
	{/if}
</label>
