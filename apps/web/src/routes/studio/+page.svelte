<script lang="ts">
	import { resolve } from '$app/paths';
	import { appBranding } from '$lib/app-branding.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes';

	type StudioTool = {
		href:
			| '/image-editor'
			| '/video-editor'
			| '/quick-cut'
			| '/record'
			| '/templates'
			| '/voice-profiles'
			| '/prompts';
		icon: ThemeIconRole;
		title: string;
		description: string;
	};

	const createTools = $derived<StudioTool[]>([
		{
			href: '/image-editor',
			icon: 'image',
			title: m.editor_start_image_title(),
			description: m.studio_description_image()
		},
		{
			href: '/video-editor',
			icon: 'video',
			title: m.editor_start_video_title(),
			description: m.studio_description_video()
		},
		{
			href: '/quick-cut',
			icon: 'editors',
			title: m.quick_cut_title(),
			description: m.studio_description_quick_cut()
		},
		{
			href: '/record',
			icon: 'video',
			title: m.record_title(),
			description: m.studio_description_record()
		}
	]);
	const libraryTools = $derived<StudioTool[]>([
		{
			href: '/templates',
			icon: 'media',
			title: m.templates_title(),
			description: m.studio_description_templates()
		},
		{
			href: '/voice-profiles',
			icon: 'edit',
			title: m.ideate_voice_profiles(),
			description: m.studio_description_voice()
		},
		{
			href: '/prompts',
			icon: 'sparkles',
			title: m.sidebar_prompts(),
			description: m.studio_description_prompts()
		}
	]);
</script>

<svelte:head>
	<title>{m.nav_studio()} · {appBranding.profile.display_name}</title>
</svelte:head>

{#snippet tools(heading: string, items: StudioTool[])}
	<section class="space-y-3">
		<h2 class="text-sm font-semibold">{heading}</h2>
		<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each items as tool (tool.href)}
				<li>
					<a
						href={resolve(tool.href)}
						class="flex h-full min-h-20 items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					>
						<ThemeIcon role={tool.icon} class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
						<span class="min-w-0">
							<span class="block text-sm font-semibold">{tool.title}</span>
							<span class="mt-0.5 block text-sm text-muted-foreground">{tool.description}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<PageContainer title={m.nav_studio()} themeIconRole="editors">
	<div class="space-y-8">
		{@render tools(m.studio_group_create(), createTools)}
		{@render tools(m.studio_group_library(), libraryTools)}
	</div>
</PageContainer>
