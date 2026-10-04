<script lang="ts">
	import { ArrowRight, Search, BookOpen, Scale, ShieldCheck } from '@lucide/svelte';
	import { marketingGuides } from '@openpost/social-images';
	import { onMount } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import HeroAccent from '../_components/HeroAccent.svelte';
	import GuideVisual from './GuideVisual.svelte';
	let { collection = 'all' }: { collection?: 'all' | 'comparisons' } = $props();
	const categories = ['All', 'Publishing', 'Images', 'Video', 'Content guides'] as const;
	let category = $state<string>('All');
	let query = $state('');
	let ready = $state(false);
	onMount(() => {
		ready = true;
	});
	const entries = $derived(
		marketingGuides.filter((guide) => collection === 'all' || guide.comparison)
	);
	const filtered = $derived(
		entries.filter(
			(guide) =>
				(category === 'All' || (guide.comparison?.category ?? 'Content guides') === category) &&
				(guide.question + ' ' + guide.socialDescription)
					.toLowerCase()
					.includes(query.trim().toLowerCase())
		)
	);
</script>

<section class="guide-directory marketing-shell" aria-labelledby="directory-title">
	<header>
		<h1 id="directory-title">
			{collection === 'comparisons' ? 'Compare your tools.' : 'Make more of your work.'}<br
			/><HeroAccent
				>{collection === 'comparisons' ? 'Choose for the job.' : 'Find a better way.'}</HeroAccent
			>
		</h1>
		<p class="marketing-copy">
			{collection === 'comparisons'
				? 'Publishing, images, and video. See what each tool costs, where it fits, and when the other option is better.'
				: 'Practical content guides and tool comparisons. Start with what you need to make, edit, or share.'}
		</p>
	</header>
	<div class="directory-layout">
		<div class="directory-main">
			<div class="controls">
				<div class="search">
					<Search size={18} aria-hidden="true" /><Input
						aria-label="Search guides and comparisons"
						type="search"
						disabled={!ready}
						bind:value={query}
						placeholder="Search a tool or a task"
					/>
				</div>
				<div class="categories" role="group" aria-label="Filter resources by category">
					{#each categories.filter((item) => collection === 'all' || item !== 'Content guides') as item (item)}
						<Button
							variant={category === item ? 'secondary' : 'ghost'}
							aria-pressed={category === item}
							disabled={!ready}
							onclick={() => (category = item)}>{item}</Button
						>
					{/each}
				</div>
			</div>
			<p class="count" role="status">
				{filtered.length}
				{filtered.length === 1 ? 'resource' : 'resources'}
			</p>
			{#each categories.slice(1) as group (group)}
				{@const guides = filtered.filter(
					(guide) => (guide.comparison?.category ?? 'Content guides') === group
				)}
				{#if guides.length}
					<section class="resource-group" aria-label={group}>
						<div class="group-heading">
							<h2>{group}</h2>
							<span
								>{group === 'Publishing'
									? 'Accounts, schedules & teams'
									: group === 'Images'
										? 'Graphics, layers & exports'
										: group === 'Video'
											? 'Recording, editing & finishing'
											: 'From an idea to a useful post'}</span
							>
						</div>
						<div class="resource-grid">
							{#each guides as guide (guide.slug)}
								<a class="resource-card focus-ring" href={'/guides/' + guide.slug}>
									<div class="visual">
										<GuideVisual {guide} />
									</div>
									<div class="card-copy">
										<h3>
											{guide.comparison ? 'OpenPost vs ' + guide.comparison.name : guide.question}
										</h3>
										<p>{guide.socialDescription}</p>
										<span class="read"
											>{guide.comparison ? 'Compare tools' : 'Read guide'}<ArrowRight
												size={16}
												aria-hidden="true"
											/></span
										>
									</div>
								</a>
							{/each}
						</div>
					</section>
				{/if}
			{/each}
			{#if !filtered.length}<div class="empty">
					<h2>No resources match that search.</h2>
					<p>Try a tool name or choose another category.</p>
					<Button
						variant="outline"
						onclick={() => {
							query = '';
							category = 'All';
						}}>Show all resources</Button
					>
				</div>{/if}
		</div>
		<aside class="directory-sidebar" aria-label="About these resources">
			<div class="sidebar-block">
				<Scale size={24} aria-hidden="true" />
				<h2>Choose for your work.</h2>
				<p>
					Some tools are better for a social team. Others go deeper into photo or video production.
					These pages explain the trade-offs.
				</p>
			</div>
			<div class="sidebar-block">
				<ShieldCheck size={21} aria-hidden="true" />
				<h2>Check the sources.</h2>
				<p>
					Written by OpenPost. Competitor facts link to official sources and show a review date.
				</p>
			</div>
			<div class="sidebar-block">
				<BookOpen size={21} aria-hidden="true" />
				<h2>Try before switching.</h2>
				<p>Our local editors are free. Hosted publishing is a separate service.</p>
				<a class="focus-ring sidebar-link" href="/tools"
					>Explore free tools <ArrowRight size={16} aria-hidden="true" /></a
				><a class="focus-ring sidebar-link" href={collection === 'all' ? '/comparisons' : '/guides'}
					>{collection === 'all' ? 'All comparisons' : 'Content guides'}
					<ArrowRight size={16} aria-hidden="true" /></a
				>
			</div>
		</aside>
	</div>
</section>

<style>
	.guide-directory {
		padding-block: 80px 100px;
	}
	header {
		max-width: 900px;
		margin-bottom: 48px;
	}
	h1 {
		font-size: clamp(36px, 5vw, 68px);
		font-weight: 550;
		letter-spacing: -0.035em;
		line-height: 1.1;
		text-wrap: balance;
		margin-bottom: 24px;
	}
	.directory-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 240px;
		gap: 56px;
	}
	.directory-main {
		min-width: 0;
	}
	.search {
		position: relative;
		max-width: 520px;
	}
	.search > :global(svg) {
		position: absolute;
		top: 14px;
		left: 14px;
		color: var(--muted-foreground);
	}
	.search :global(input) {
		padding-left: 42px;
		min-height: 46px;
	}
	.categories {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 16px;
	}
	.categories :global(button) {
		min-height: 44px;
	}
	.count {
		font-size: 13px;
		color: var(--muted-foreground);
		margin-top: 20px;
	}
	.resource-group {
		margin-top: 40px;
	}
	.group-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 18px;
	}
	h2 {
		font-size: 23px;
		font-weight: 550;
		letter-spacing: -0.02em;
	}
	.group-heading > span {
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.resource-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 24px;
	}
	.resource-card {
		display: block;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
	}
	.resource-card:hover {
		border-color: var(--primary);
	}
	.visual {
		height: 200px;
		overflow: hidden;
	}
	.card-copy {
		padding: 24px;
	}
	h3 {
		font-size: 21px;
		font-weight: 550;
		line-height: 1.25;
		letter-spacing: -0.02em;
		text-wrap: balance;
	}
	.card-copy p {
		font-size: 14px;
		line-height: 1.7;
		color: var(--muted-foreground);
		margin-top: 12px;
	}
	.read {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 22px;
		font-size: 13px;
		font-weight: 600;
		color: var(--primary);
	}
	.directory-sidebar {
		align-self: start;
		position: sticky;
		top: 110px;
	}
	.sidebar-block {
		border-top: 1px solid var(--border);
		padding-block: 24px;
	}
	.sidebar-block > :global(svg) {
		color: var(--primary);
		margin-bottom: 14px;
	}
	.sidebar-block h2 {
		font-size: 16px;
	}
	.sidebar-block p {
		font-size: 14px;
		line-height: 1.75;
		color: var(--muted-foreground);
		margin-top: 10px;
	}
	.sidebar-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 44px;
		gap: 10px;
		font-size: 14px;
		color: var(--primary);
		border-radius: 4px;
	}
	.empty {
		padding-block: 56px;
	}
	.empty p {
		margin-block: 12px 24px;
		color: var(--muted-foreground);
	}
	@media (max-width: 1023px) {
		.directory-layout {
			grid-template-columns: 1fr;
		}
		.directory-sidebar {
			position: static;
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 24px;
		}
	}
	@media (max-width: 639px) {
		.guide-directory {
			padding-block: 48px 64px;
		}
		.resource-grid,
		.directory-sidebar {
			grid-template-columns: 1fr;
		}
		.group-heading {
			display: block;
		}
		.group-heading > span {
			display: block;
			margin-top: 6px;
		}
		.visual {
			height: 172px;
		}
		.card-copy {
			padding: 20px;
		}
	}
</style>
