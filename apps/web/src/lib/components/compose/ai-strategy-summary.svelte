<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { getPlatformName } from '$lib/utils';
	import Disclosure from '../disclosure.svelte';
	import type { AIPlatformStrategy } from './ai-build-metadata';

	// What the applied AI build aimed for on each destination, and the media it recommended.
	let { strategies }: { strategies: AIPlatformStrategy[] } = $props();

	function localizedAIObjective(objective: string): string {
		switch (objective) {
			case 'reach':
				return m.compose_ai_objective_reach();
			case 'comments':
				return m.compose_ai_objective_comments();
			case 'reposts':
				return m.compose_ai_objective_reposts();
			case 'authority':
				return m.compose_ai_objective_authority();
			case 'trust':
				return m.compose_ai_objective_trust();
			case 'shares':
				return m.compose_ai_objective_shares();
			case 'conversation':
				return m.compose_ai_objective_conversation();
			case 'follows':
				return m.compose_ai_objective_follows();
			case 'clicks':
				return m.compose_ai_objective_clicks();
			case 'boosts':
				return m.compose_ai_objective_boosts();
			case 'hashtag_discovery':
				return m.compose_ai_objective_hashtag_discovery();
			case 'following':
				return m.compose_ai_objective_following_feed();
			case 'discover':
				return m.compose_ai_objective_discover();
			case 'target_feed':
				return m.compose_ai_objective_target_feed();
			case 'quotes':
				return m.compose_ai_objective_quotes();
			case 'community_growth':
				return m.compose_ai_objective_community_growth();
			case 'cross_meta_reach':
				return m.compose_ai_objective_cross_meta_reach();
			default:
				return m.compose_ai_objective_platform_goal();
		}
	}

	function localizedAIMediaTreatment(treatment: string): string {
		switch (treatment) {
			case 'use_source':
				return m.compose_ai_media_use_source();
			case 'annotate_source':
				return m.compose_ai_media_annotate_source();
			case 'meme':
				return m.compose_ai_media_meme();
			case 'statement_card':
				return m.compose_ai_media_statement_card();
			case 'carousel':
				return m.compose_ai_media_carousel();
			case 'concept_image':
				return m.compose_ai_media_concept_image();
			case 'short_video_script':
				return m.compose_ai_media_short_video();
			case 'edit_existing_video':
				return m.compose_ai_media_edit_video();
			default:
				return m.compose_ai_media_recommended();
		}
	}
</script>

<Disclosure summary={m.compose_ai_strategy_label()} summaryClass="text-muted-foreground">
	<div
		class="mb-3 flex gap-2 overflow-x-auto border-y py-3"
		aria-label={m.compose_ai_strategy_label()}
	>
		{#each strategies as destination (destination.account_id)}
			<div class="min-w-48 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
				<p class="font-medium text-foreground">
					{getPlatformName(destination.platform)} · {localizedAIObjective(destination.objective)}
				</p>
				<p class="mt-1 text-muted-foreground">
					{destination.media.treatment === 'none'
						? m.compose_ai_no_media_recommended()
						: destination.media.brief || localizedAIMediaTreatment(destination.media.treatment)}
				</p>
				{#if destination.warnings?.length}
					<p class="mt-1 text-amber-700 dark:text-amber-300">
						{destination.warnings.join(' ')}
					</p>
				{/if}
			</div>
		{/each}
	</div>
</Disclosure>
