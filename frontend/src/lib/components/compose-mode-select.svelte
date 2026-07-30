<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import AlignLeftIcon from 'lucide-svelte/icons/align-left';
	import ListIcon from 'lucide-svelte/icons/list';
	import PlayIcon from 'lucide-svelte/icons/play';
	import SmartphoneIcon from 'lucide-svelte/icons/smartphone';
	import VideoIcon from 'lucide-svelte/icons/video';
	import { m } from '$lib/paraglide/messages';
	import {
		COMPOSER_MODE_GROUPS,
		COMPOSER_MODE_KEYS,
		composerMode,
		type ComposerModeKey
	} from './compose/modes';

	const modeIcons: Partial<Record<ComposerModeKey, typeof AlignLeftIcon>> = {
		post: AlignLeftIcon,
		thread: ListIcon,
		story: SmartphoneIcon,
		short_video: PlayIcon,
		video: VideoIcon
	};

	interface Props {
		selectedMode: ComposerModeKey;
		onModeChange: (mode: ComposerModeKey) => void;
		class?: string;
		compactOnNarrow?: boolean;
	}

	let { selectedMode, onModeChange, class: className, compactOnNarrow = false }: Props = $props();
	const selectedModeMeta = $derived(composerMode(selectedMode));
	const SelectedIcon = $derived(modeIcons[selectedMode] ?? AlignLeftIcon);

	function handleValueChange(value: string) {
		if (!COMPOSER_MODE_KEYS.includes(value as ComposerModeKey)) return;
		onModeChange(value as ComposerModeKey);
	}
</script>

<Select.Root type="single" value={selectedMode} onValueChange={handleValueChange}>
	<Select.Trigger
		class={cn(
			'h-8 w-32 max-w-32 min-w-0 text-xs',
			compactOnNarrow &&
				'max-[430px]:w-11 max-[430px]:max-w-11 max-[430px]:justify-center max-[430px]:px-2 max-[430px]:[&>svg:last-of-type]:hidden',
			className
		)}
		aria-label={m.compose_post_type()}
		data-testid="composer-mode-select"
	>
		<span class="flex min-w-0 items-center gap-1.5">
			<SelectedIcon class="size-3.5 text-muted-foreground" />
			<span class={cn('truncate', compactOnNarrow && 'max-[430px]:sr-only')}
				>{selectedModeMeta.label}</span
			>
		</span>
	</Select.Trigger>
	<Select.Content
		class="max-h-[min(34rem,var(--bits-select-content-available-height))] w-80 max-w-[calc(100vw-1.5rem)]"
	>
		<Select.Label class="px-3 pt-2 pb-1 font-medium text-foreground"
			>{m.compose_post_type()}</Select.Label
		>
		{#each COMPOSER_MODE_GROUPS as group, groupIndex (group.key)}
			{#if groupIndex > 0}
				<Select.Separator class="mx-2" />
			{/if}
			<Select.Group class="px-1.5 py-1">
				<Select.GroupHeading
					class="px-2 py-1 font-mono text-xs font-medium tracking-[0.12em] uppercase"
				>
					{group.key === 'write' ? m.compose_group_write() : m.compose_group_media()}
				</Select.GroupHeading>
				{#each group.modes as mode (mode.key)}
					{@const Icon = modeIcons[mode.key] ?? AlignLeftIcon}
					{@const modeCopy = composerMode(mode.key)}
					<Select.Item
						value={mode.key}
						class="min-h-12 items-start gap-2.5 px-2 py-2 pr-8"
						data-testid={`composer-mode-option-${mode.key}`}
					>
						<Icon class="mt-0.5 size-4 text-muted-foreground" />
						<span class="min-w-0 flex-col items-start! gap-0!">
							<span class="text-xs/4 font-medium text-foreground">{modeCopy.label}</span>
							<span class="line-clamp-2 text-xs/4 text-muted-foreground">
								{modeCopy.description}
							</span>
						</span>
					</Select.Item>
				{/each}
			</Select.Group>
		{/each}
		<Select.Separator class="mx-2" />
		<a
			href={resolve('/video-studio' as '/')}
			class="mx-1.5 my-1 flex min-h-12 items-start gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		>
			<VideoIcon class="mt-0.5 size-4 text-muted-foreground" />
			<span class="min-w-0">
				<span class="block font-medium text-foreground">{m.compose_create_video_studio()}</span>
				<span class="mt-0.5 block leading-4 text-muted-foreground">
					{m.compose_create_video_studio_description()}
				</span>
			</span>
		</a>
	</Select.Content>
</Select.Root>
