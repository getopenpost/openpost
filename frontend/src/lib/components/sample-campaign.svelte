<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import PlatformPreview from '$lib/components/platform-preview.svelte';
	import { platformCharacterLimit } from '$lib/platform-limits';
	import { getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import ArrowRightIcon from 'lucide-svelte/icons/arrow-right';
	import BotIcon from 'lucide-svelte/icons/bot';
	import CheckIcon from 'lucide-svelte/icons/check';
	import CircleCheckIcon from 'lucide-svelte/icons/circle-check-big';
	import EyeIcon from 'lucide-svelte/icons/eye';
	import FilePenIcon from 'lucide-svelte/icons/file-pen-line';
	import ShieldCheckIcon from 'lucide-svelte/icons/shield-check';

	const platformOrder = ['x', 'linkedin', 'bluesky', 'mastodon', 'threads'] as const;
	type SamplePlatform = (typeof platformOrder)[number];

	interface Props {
		onSkip: () => void;
		onContinue: () => void;
		continueLabel: string;
	}

	interface SampleDestination {
		platform: SamplePlatform;
		account: string;
		username: string;
		displayName: string;
		suggestedSlot: string;
	}

	let { onSkip, onContinue, continueLabel }: Props = $props();

	const destinations = $derived<SampleDestination[]>([
		{
			platform: 'x',
			account: '@openpost · X',
			username: 'openpost',
			displayName: 'OpenPost',
			suggestedSlot: '09:15'
		},
		{
			platform: 'linkedin',
			account: 'OpenPost · LinkedIn',
			username: 'openpost',
			displayName: 'OpenPost',
			suggestedSlot: '09:30'
		},
		{
			platform: 'bluesky',
			account: '@openpost.social · Bluesky',
			username: 'openpost.social',
			displayName: 'OpenPost',
			suggestedSlot: '10:00'
		},
		{
			platform: 'mastodon',
			account: '@openpost@fosstodon.org · Mastodon',
			username: 'openpost@fosstodon.org',
			displayName: 'OpenPost',
			suggestedSlot: '10:15'
		},
		{
			platform: 'threads',
			account: '@openpost · Threads',
			username: 'openpost',
			displayName: 'OpenPost',
			suggestedSlot: '10:30'
		}
	]);

	let activePlatform = $state<SamplePlatform>('x');
	let reviewedPlatforms = $state<SamplePlatform[]>([]);
	let contentByPlatform = $state<Record<SamplePlatform, string>>({
		x: m.sample_campaign_x_content(),
		linkedin: m.sample_campaign_linkedin_content(),
		bluesky: m.sample_campaign_bluesky_content(),
		mastodon: m.sample_campaign_mastodon_content(),
		threads: m.sample_campaign_threads_content()
	});

	const activeDestination = $derived(
		destinations.find((destination) => destination.platform === activePlatform) ?? destinations[0]
	);
	const activeContent = $derived(contentByPlatform[activePlatform]);
	const activeLimit = $derived(platformCharacterLimit(activePlatform));
	const activeReviewed = $derived(reviewedPlatforms.includes(activePlatform));
	const allReviewed = $derived(reviewedPlatforms.length === destinations.length);

	function setActiveContent(value: string) {
		contentByPlatform[activePlatform] = value;
		if (reviewedPlatforms.includes(activePlatform)) {
			reviewedPlatforms = reviewedPlatforms.filter((platform) => platform !== activePlatform);
		}
	}

	function toggleReviewed() {
		if (activeReviewed) {
			reviewedPlatforms = reviewedPlatforms.filter((platform) => platform !== activePlatform);
			return;
		}
		reviewedPlatforms = [...reviewedPlatforms, activePlatform];
	}
</script>

<div
	class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
	data-testid="sample-campaign"
>
	<header class="shrink-0 border-b bg-background px-4 py-3 md:px-6 md:py-4">
		<div class="mx-auto flex w-full max-w-7xl items-start justify-between gap-4">
			<div class="min-w-0">
				<div class="mb-2 flex flex-wrap items-center gap-2">
					<Badge class="border-primary/25 bg-primary/10 text-primary">
						{m.sample_campaign_badge()}
					</Badge>
					<span class="text-xs text-muted-foreground">{m.sample_campaign_not_saved()}</span>
				</div>
				<h1 class="text-xl font-semibold tracking-[-0.025em] text-balance md:text-2xl">
					{m.sample_campaign_title()}
				</h1>
				<p class="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
					{m.sample_campaign_description()}
				</p>
			</div>
			<Button variant="ghost" size="sm" class="shrink-0" onclick={onSkip}>
				{m.sample_campaign_skip()}
			</Button>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<div
			class="mx-auto grid w-full max-w-7xl gap-5 px-4 py-5 md:px-6 md:py-6 lg:grid-cols-[21rem_minmax(0,1fr)]"
		>
			<aside class="self-start overflow-hidden rounded-lg border bg-card">
				<section class="border-b p-4 md:p-5" aria-labelledby="sample-canonical-title">
					<div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
						<FilePenIcon class="size-4" />
						{m.sample_campaign_canonical_label()}
					</div>
					<h2 id="sample-canonical-title" class="mt-3 text-base font-semibold">
						{m.sample_campaign_canonical_title()}
					</h2>
					<p class="mt-2 text-sm leading-6 text-foreground/80">
						{m.sample_campaign_canonical_content()}
					</p>
				</section>

				<section class="p-4 md:p-5" aria-labelledby="sample-handoff-title">
					<div class="flex items-center justify-between gap-3">
						<h2 id="sample-handoff-title" class="text-sm font-semibold">
							{m.sample_campaign_handoff_title()}
						</h2>
						<BotIcon class="size-4 text-primary" />
					</div>

					<ol class="mt-4 space-y-4">
						<li class="flex gap-3">
							<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
								<EyeIcon class="size-4 text-muted-foreground" />
							</div>
							<div>
								<h3 class="text-sm font-medium">{m.sample_campaign_handoff_read_title()}</h3>
								<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
									{m.sample_campaign_handoff_read_body()}
								</p>
							</div>
						</li>
						<li class="flex gap-3">
							<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
								<FilePenIcon class="size-4 text-muted-foreground" />
							</div>
							<div>
								<h3 class="text-sm font-medium">{m.sample_campaign_handoff_draft_title()}</h3>
								<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
									{m.sample_campaign_handoff_draft_body()}
								</p>
							</div>
						</li>
						<li class="flex gap-3">
							<div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
								<ShieldCheckIcon class="size-4 text-muted-foreground" />
							</div>
							<div>
								<h3 class="text-sm font-medium">{m.sample_campaign_handoff_execute_title()}</h3>
								<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
									{m.sample_campaign_handoff_execute_body()}
								</p>
							</div>
						</li>
					</ol>
				</section>
			</aside>

			<section
				class="min-w-0 overflow-hidden rounded-lg border bg-card"
				aria-labelledby="sample-review-title"
			>
				<div class="border-b px-4 py-4 md:px-5">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 id="sample-review-title" class="text-base font-semibold">
								{m.sample_campaign_review_title()}
							</h2>
							<p class="mt-0.5 text-sm text-muted-foreground">
								{m.sample_campaign_review_description()}
							</p>
						</div>
						<p class="text-xs font-medium text-muted-foreground" aria-live="polite">
							{m.sample_campaign_review_progress({
								reviewed: reviewedPlatforms.length,
								total: destinations.length
							})}
						</p>
					</div>

					<div
						class="-mx-1 mt-4 flex gap-1 overflow-x-auto px-1 pb-1"
						role="tablist"
						aria-label={m.sample_campaign_destinations_label()}
					>
						{#each destinations as destination (destination.platform)}
							<button
								type="button"
								role="tab"
								id="sample-tab-{destination.platform}"
								aria-selected={activePlatform === destination.platform}
								aria-controls="sample-rendition-panel"
								class={[
									'flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
									activePlatform === destination.platform
										? 'bg-primary/10 text-primary'
										: 'text-muted-foreground hover:bg-muted hover:text-foreground'
								]}
								onclick={() => (activePlatform = destination.platform)}
							>
								<PlatformIcon platform={destination.platform} class="size-4" />
								<span>{getPlatformName(destination.platform)}</span>
								{#if reviewedPlatforms.includes(destination.platform)}
									<CheckIcon class="size-3.5" aria-label={m.sample_campaign_reviewed()} />
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<div
					id="sample-rendition-panel"
					role="tabpanel"
					aria-labelledby="sample-tab-{activePlatform}"
					class="p-4 md:p-5"
				>
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p class="text-xs font-medium text-muted-foreground">
								{m.sample_campaign_example_destination()}
							</p>
							<p class="mt-1 text-sm font-semibold">{activeDestination.account}</p>
						</div>
						<div class="text-right text-xs text-muted-foreground">
							<p>{m.sample_campaign_suggested_slot()}</p>
							<p class="mt-1 font-medium text-foreground tabular-nums">
								{activeDestination.suggestedSlot} · {m.sample_campaign_local_time()}
							</p>
						</div>
					</div>

					<div class="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(20rem,1.08fr)]">
						<div class="min-w-0">
							<div class="flex items-end justify-between gap-3">
								<label for="sample-rendition-content" class="text-sm font-medium">
									{m.sample_campaign_content_label({
										platform: getPlatformName(activePlatform)
									})}
								</label>
								<span
									class:text-destructive={activeContent.length > activeLimit}
									class="text-xs text-muted-foreground tabular-nums"
								>
									{m.sample_campaign_character_count({
										count: activeContent.length,
										limit: activeLimit
									})}
								</span>
							</div>
							<Textarea
								id="sample-rendition-content"
								value={activeContent}
								oninput={(event) => setActiveContent(event.currentTarget.value)}
								class="mt-2 min-h-64 resize-y bg-background text-sm leading-6 md:text-sm"
								aria-describedby="sample-content-hint"
							/>
							<p id="sample-content-hint" class="mt-2 text-xs leading-5 text-muted-foreground">
								{m.sample_campaign_content_hint()}
							</p>
						</div>

						<div class="min-w-0">
							<p class="mb-2 text-sm font-medium">{m.sample_campaign_preview()}</p>
							<div class="overflow-hidden rounded-lg bg-background">
								<PlatformPreview
									platform={activePlatform}
									content={activeContent}
									mediaIds={[]}
									username={activeDestination.username}
									displayName={activeDestination.displayName}
									isUnsynced
								/>
							</div>
						</div>
					</div>

					<div
						class="mt-5 flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"
					>
						<p class="text-xs leading-5 text-muted-foreground">
							{activeReviewed
								? m.sample_campaign_reviewed_body()
								: m.sample_campaign_review_needed_body()}
						</p>
						<Button
							variant={activeReviewed ? 'secondary' : 'default'}
							class="sm:shrink-0"
							onclick={toggleReviewed}
							aria-pressed={activeReviewed}
						>
							{#if activeReviewed}<CheckIcon class="size-4" />{/if}
							{activeReviewed
								? m.sample_campaign_mark_unreviewed()
								: m.sample_campaign_mark_reviewed()}
						</Button>
					</div>
				</div>
			</section>

			<div class="lg:col-start-2">
				{#if allReviewed}
					<InlineNotice tone="success">
						<div class="flex gap-2">
							<CircleCheckIcon class="mt-0.5 size-4 shrink-0" />
							<div>
								<p class="font-medium">{m.sample_campaign_complete_title()}</p>
								<p class="mt-0.5 text-xs leading-5">{m.sample_campaign_complete_body()}</p>
							</div>
						</div>
					</InlineNotice>
				{/if}

				<div
					class="mt-4 flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"
				>
					<p class="max-w-2xl text-xs leading-5 text-muted-foreground">
						{m.sample_campaign_local_only()}
					</p>
					<Button class="shrink-0" onclick={onContinue}>
						{continueLabel}
						<ArrowRightIcon class="size-4" />
					</Button>
				</div>
			</div>
		</div>
	</div>
</div>
