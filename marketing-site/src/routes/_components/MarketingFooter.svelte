<script lang="ts">
	import Github from 'lucide-svelte/icons/github';
	import Logo from '$lib/components/Logo.svelte';
	import {
		comparisons,
		developerDocsUrl,
		demoVideoUrl,
		githubUrl,
		platforms,
		selfHostingDocsUrl,
		tools,
		userDocsUrl
	} from '../_marketing';

	const groups = [
		{
			title: 'Product',
			links: [
				{ label: 'Pricing', href: '/pricing' },
				{ label: 'Platforms', href: '/platforms' },
				{ label: 'Compare', href: '/compare' },
				{ label: 'Free tools', href: '/tools' },
				{ label: 'Security', href: '/security' },
				{ label: 'Open source', href: '/open-source' }
			]
		},
		{
			title: 'Platforms',
			links: platforms.slice(0, 6).map((platform) => ({
				label: platform.name,
				href: `/platforms/${platform.slug}`
			}))
		},
		{
			title: 'Compare',
			links: comparisons.slice(0, 6).map((comparison) => ({
				label: `vs. ${comparison.name}`,
				href: `/compare/${comparison.slug}`
			}))
		},
		{
			title: 'Resources',
			links: [
				{ label: 'Product demo', href: demoVideoUrl },
				{ label: 'User docs', href: userDocsUrl },
				{ label: 'Self-hosting docs', href: selfHostingDocsUrl },
				{ label: 'Developer docs', href: developerDocsUrl },
				{ label: 'Changelog', href: '/changelog' },
				{ label: 'Privacy', href: '/privacy' },
				{ label: 'Terms', href: '/terms' },
				{ label: tools[0].name, href: `/tools/${tools[0].slug}` }
			]
		}
	];
</script>

<footer class="border-t bg-muted/30">
	<div class="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_2fr] lg:px-8">
		<div>
			<a href="/" class="inline-flex items-center gap-2" aria-label="OpenPost home">
				<Logo width={34} height={26} />
				<span class="text-sm font-semibold">OpenPost</span>
			</a>
			<p class="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
				The publishing workspace between AI agents and social accounts: provider-aware,
				human-reviewed, and open source.
			</p>
			<a
				href={githubUrl}
				target="_blank"
				rel="noreferrer"
				class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
			>
				<Github class="size-4" />
				GitHub source
			</a>
		</div>

		<div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
			{#each groups as group (group.title)}
				<div>
					<h2 class="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
						{group.title}
					</h2>
					<ul class="mt-4 grid gap-2">
						{#each group.links as link (link.href)}
							<li>
								<a
									href={link.href}
									class="text-sm text-muted-foreground transition hover:text-foreground"
								>
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</div>
	<div
		class="mx-auto flex max-w-7xl flex-col gap-2 border-t px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"
	>
		<span>Copyright 2026 OpenPost Contributors.</span>
		<span>Managed or self-hosted. AGPL-3.0-only.</span>
	</div>
</footer>
