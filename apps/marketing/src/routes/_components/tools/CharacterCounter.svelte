<script lang="ts">
	import { RotateCcw, Sparkles } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import {
		COUNTER_PLATFORMS,
		graphemeCount,
		platformTextCount,
		wordCount
	} from '../../tools/_lib/tool-utils';

	const example =
		'Something new is coming Friday. Here’s a first look at what we’ve been making. https://example.com';
	let draft = $state(example);

	const visibleCharacters = $derived(graphemeCount(draft));
	const words = $derived(wordCount(draft));
	const lines = $derived(draft ? draft.split(/\r?\n/u).length : 0);
	const platformCounts = $derived(
		COUNTER_PLATFORMS.map((platform) => ({
			...platform,
			count: platformTextCount(draft, platform.key)
		}))
	);
</script>

<div class="counter">
	<div class="counter-input">
		<div class="counter-toolbar">
			<label for="character-counter-input">Your post</label>
			<div>
				<Button type="button" size="sm" variant="ghost" onclick={() => (draft = example)}
					><Sparkles data-icon="inline-start" />Example</Button
				><Button type="button" size="sm" variant="ghost" onclick={() => (draft = '')}
					><RotateCcw data-icon="inline-start" />Clear</Button
				>
			</div>
		</div>
		<Textarea
			id="character-counter-input"
			bind:value={draft}
			class="min-h-60 p-4 text-base leading-7 md:text-base"
			placeholder="Paste or write a social post..."
			spellcheck="true"
			aria-label="Post text"
		/>
		<dl>
			<div>
				<dt>Characters</dt>
				<dd>{visibleCharacters.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Words</dt>
				<dd>{words.toLocaleString()}</dd>
			</div>
			<div>
				<dt>Lines</dt>
				<dd>{lines.toLocaleString()}</dd>
			</div>
		</dl>
	</div>
	<section aria-labelledby="platform-counts-title">
		<h2 id="platform-counts-title">How it fits</h2>
		<div class="counts">
			{#each platformCounts as platform (platform.key)}
				{@const remaining = platform.limit - platform.count}
				<div class="count">
					<div class="count-label">
						<PlatformIcon platform={platform.key} class="size-4" />
						<h3>{platform.name}</h3>
						<span class:over={remaining < 0}
							>{platform.count.toLocaleString()} / {platform.limit.toLocaleString()}</span
						>
					</div>
					<div
						class="meter"
						role="progressbar"
						aria-label={`${platform.name} character use`}
						aria-valuemin="0"
						aria-valuemax={platform.limit}
						aria-valuenow={Math.min(platform.count, platform.limit)}
					>
						<span
							class:over={remaining < 0}
							style:width={`${Math.min(100, (platform.count / platform.limit) * 100)}%`}
						></span>
					</div>
					<p class:over={remaining < 0}>
						{remaining >= 0
							? `${remaining.toLocaleString()} left`
							: `${Math.abs(remaining).toLocaleString()} over`}
					</p>
					<p class="count-note">{platform.note}</p>
				</div>
			{/each}
		</div>
	</section>
</div>

<style>
	.counter {
		border: 1px solid var(--border);
		border-radius: 16px;
		overflow: hidden;
		background: var(--card);
	}
	.counter-input {
		padding: 20px;
	}
	.counter-toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}
	.counter-toolbar label {
		font-weight: 550;
	}
	.counter-toolbar > div {
		display: flex;
	}
	dl {
		display: flex;
		flex-wrap: wrap;
		gap: 24px;
		margin-top: 16px;
	}
	dl div {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	dt {
		font-size: 12px;
		color: var(--muted-foreground);
	}
	dd {
		font-variant-numeric: tabular-nums;
		font-weight: 550;
	}
	section {
		padding: 20px;
		border-top: 1px solid var(--border);
	}
	h2 {
		font-size: 14px;
		font-weight: 550;
		margin-bottom: 20px;
	}
	.counts {
		display: grid;
		gap: 24px;
	}
	.count-label {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	h3 {
		font-size: 12px;
		font-weight: 550;
	}
	.count-label > span {
		font-size: 11px;
		color: var(--muted-foreground);
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
	.meter {
		height: 3px;
		background: var(--muted);
		margin-top: 10px;
		overflow: hidden;
	}
	.meter span {
		display: block;
		height: 100%;
		background: var(--primary);
	}
	.meter span.over {
		background: var(--destructive);
	}
	.count p {
		margin-top: 5px;
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.count .count-note {
		font-size: 11px;
		line-height: 1.6;
		max-width: 42ch;
		margin-top: 8px;
	}
	.count p.over,
	.count-label > .over {
		color: var(--destructive);
	}
	@container tool (min-width: 550px) {
		.counts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
