<script lang="ts">
	import BetweenHorizontalStartIcon from '@lucide/svelte/icons/between-horizontal-start';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import ClapperboardIcon from '@lucide/svelte/icons/clapperboard';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import FileAudioIcon from '@lucide/svelte/icons/file-audio';
	import FileIcon from '@lucide/svelte/icons/file';
	import FilmIcon from '@lucide/svelte/icons/film';
	import ImageIcon from '@lucide/svelte/icons/image';
	import ImagesIcon from '@lucide/svelte/icons/images';
	import InfoIcon from '@lucide/svelte/icons/info';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import MoveIcon from '@lucide/svelte/icons/move';
	import ErrorIcon from '@lucide/svelte/icons/octagon-x';
	import PanelsTopLeftIcon from '@lucide/svelte/icons/panels-top-left';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import ShapesIcon from '@lucide/svelte/icons/shapes';
	import StickerIcon from '@lucide/svelte/icons/sticker';
	import TypeIcon from '@lucide/svelte/icons/type';
	import WarningIcon from '@lucide/svelte/icons/triangle-alert';
	import VideoIcon from '@lucide/svelte/icons/video';
	import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
	import type { ProtectedIconRole } from './protected-icon.js';

	type Props = {
		icon: ProtectedIconRole;
		label?: string;
		class?: string;
	};

	let { icon, label, class: className }: Props = $props();
	const Icon = $derived(
		{
			'editor-animation': FilmIcon,
			'editor-backgrounds': PanelsTopLeftIcon,
			'editor-captions': CaptionsIcon,
			'editor-cut': ScissorsIcon,
			'editor-effects': WandSparklesIcon,
			'editor-media': ImagesIcon,
			'editor-move': MoveIcon,
			'editor-record': VideoIcon,
			'editor-scenes': ClapperboardIcon,
			'editor-shapes': ShapesIcon,
			'editor-stickers': StickerIcon,
			'editor-text': TypeIcon,
			'editor-transitions': BetweenHorizontalStartIcon,
			error: ErrorIcon,
			info: InfoIcon,
			loading: LoaderIcon,
			'media-audio': FileAudioIcon,
			'media-file': FileIcon,
			'media-image': ImageIcon,
			'media-video': VideoIcon,
			pause: PauseIcon,
			play: PlayIcon,
			success: CircleCheckIcon,
			warning: WarningIcon
		}[icon]
	);
</script>

<Icon
	class={className}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	data-protected-icon={icon}
/>
