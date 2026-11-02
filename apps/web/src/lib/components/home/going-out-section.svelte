<script lang="ts">
	import { resolveAppPath } from '$lib/app-path';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	export interface GoingOutPost {
		id: string;
		title: string;
		occurrence: string | null;
		timeZone: string;
	}

	interface Props {
		posts: GoingOutPost[];
	}

	let { posts }: Props = $props();

	function rowTitle(title: string) {
		return title.trim() || m.calendar_untitled_publication();
	}

	function rowHref(id: string) {
		return resolveAppPath(`/publications/${encodeURIComponent(id)}`);
	}

	function rowTime(post: GoingOutPost) {
		if (!post.occurrence) return '';
		return new Date(post.occurrence).toLocaleString(getLocaleTag(), {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: post.timeZone
		});
	}
</script>

<section aria-labelledby="home-going-out-heading" data-testid="home-going-out">
	<h2 id="home-going-out-heading" class="text-sm font-medium text-muted-foreground">
		{m.home_section_going_out()}
	</h2>
	<ul class="mt-2 divide-y rounded-lg border">
		{#each posts as post (post.id)}
			<li>
				<a
					href={rowHref(post.id)}
					class="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>
					<span class="min-w-0 flex-1 truncate">{rowTitle(post.title)}</span>
					<span class="shrink-0 text-xs text-muted-foreground tabular-nums">
						{rowTime(post)}
					</span>
				</a>
			</li>
		{/each}
	</ul>
</section>
