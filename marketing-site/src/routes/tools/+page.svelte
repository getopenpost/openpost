<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowRight, LockKeyhole } from '@lucide/svelte';
	import { tools } from '../_marketing';

	const groups = [
		{
			title: 'Preview',
			description: 'Check each platform version before you publish.',
			slugs: ['post-preview-generator']
		},
		{
			title: 'Write',
			description: 'Make the copy fit without losing its meaning.',
			slugs: ['multi-platform-character-counter', 'thread-splitter', 'linkedin-text-formatter']
		},
		{
			title: 'Prepare media',
			description: 'Build and export the visual asset.',
			slugs: ['social-media-video-editor', 'social-media-image-editor']
		},
		{
			title: 'Plan and verify',
			description: 'Turn a draft into a usable publishing plan.',
			slugs: ['best-time-to-post-calculator', 'fediverse-handle-checker']
		}
	] as const;

	const outcomes: Record<string, string> = {
		'social-media-video-editor': 'Edit and export videos',
		'social-media-image-editor': 'Edit and export images',
		'multi-platform-character-counter': 'Compare ten limits',
		'post-preview-generator': 'Preview ten platforms and their formats',
		'thread-splitter': 'Split without losing text',
		'fediverse-handle-checker': 'Validate syntax or check live',
		'linkedin-text-formatter': 'Clean readable plain text',
		'best-time-to-post-calculator': 'Build and export a weekly plan'
	};

	function toolsForGroup(slugs: readonly string[]) {
		return slugs
			.map((slug) => tools.find((tool) => tool.slug === slug))
			.filter((tool): tool is (typeof tools)[number] => Boolean(tool));
	}
</script>

<section class="border-b py-14 sm:py-20">
	<div class="marketing-shell grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
		<div>
			<p class="section-label">Free tools</p>
			<h1
				class="mt-4 max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
			>
				Finish the post before you sign up.
			</h1>
		</div>
		<div>
			<p class="marketing-copy">
				Preview posts, check limits, split copy, prepare media, and plan a weekly schedule in your
				browser.
			</p>
			<p class="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
				<LockKeyhole class="size-4 text-primary" />
				Drafts stay local unless a tool clearly offers a live network check.
			</p>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid gap-16">
		{#each groups as group (group.title)}
			<section aria-labelledby={`tool-group-${group.title.toLowerCase().replaceAll(' ', '-')}`}>
				<div class="grid gap-2 border-b pb-5 sm:grid-cols-[0.55fr_1.45fr] sm:items-end">
					<h2
						id={`tool-group-${group.title.toLowerCase().replaceAll(' ', '-')}`}
						class="text-2xl font-semibold tracking-[-0.025em]"
					>
						{group.title}
					</h2>
					<p class="text-sm leading-6 text-muted-foreground">
						{group.description}
					</p>
				</div>
				<div>
					{#each toolsForGroup(group.slugs) as tool (tool.slug)}
						{@const Icon = tool.icon}
						<a
							href={resolve(`/tools/${tool.slug}`)}
							class="focus-ring group grid min-h-32 gap-4 border-b py-6 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6"
						>
							<span class="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
								<Icon class="size-5" aria-hidden="true" />
							</span>
							<span>
								<strong class="text-lg">{tool.name}</strong>
								<span class="mt-1 block max-w-2xl text-sm leading-6 text-muted-foreground">
									{tool.description}
								</span>
							</span>
							<span class="flex items-center gap-2 text-sm font-medium text-primary">
								{outcomes[tool.slug]}
								<ArrowRight
									class="size-4 transition-transform group-hover:translate-x-1"
									aria-hidden="true"
								/>
							</span>
						</a>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</section>
