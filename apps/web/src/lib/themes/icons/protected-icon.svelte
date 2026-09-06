<script lang="ts">
	import AlignCenterHorizontalIcon from '@lucide/svelte/icons/align-center-horizontal';
	import AlignCenterVerticalIcon from '@lucide/svelte/icons/align-center-vertical';
	import AlignEndHorizontalIcon from '@lucide/svelte/icons/align-end-horizontal';
	import AlignEndVerticalIcon from '@lucide/svelte/icons/align-end-vertical';
	import AlignHorizontalDistributeCenterIcon from '@lucide/svelte/icons/align-horizontal-distribute-center';
	import AlignStartHorizontalIcon from '@lucide/svelte/icons/align-start-horizontal';
	import AlignStartVerticalIcon from '@lucide/svelte/icons/align-start-vertical';
	import AlignVerticalDistributeCenterIcon from '@lucide/svelte/icons/align-vertical-distribute-center';
	import BetweenHorizontalStartIcon from '@lucide/svelte/icons/between-horizontal-start';
	import BlendIcon from '@lucide/svelte/icons/blend';
	import BringToFrontIcon from '@lucide/svelte/icons/bring-to-front';
	import BrushIcon from '@lucide/svelte/icons/brush';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import CircleDashedIcon from '@lucide/svelte/icons/circle-dashed';
	import ClapperboardIcon from '@lucide/svelte/icons/clapperboard';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import Columns2Icon from '@lucide/svelte/icons/columns-2';
	import CombineIcon from '@lucide/svelte/icons/combine';
	import CropIcon from '@lucide/svelte/icons/crop';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import EraserIcon from '@lucide/svelte/icons/eraser';
	import FileAudioIcon from '@lucide/svelte/icons/file-audio';
	import FileIcon from '@lucide/svelte/icons/file';
	import FilmIcon from '@lucide/svelte/icons/film';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import FlipHorizontal2Icon from '@lucide/svelte/icons/flip-horizontal-2';
	import FlipVertical2Icon from '@lucide/svelte/icons/flip-vertical-2';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import GroupIcon from '@lucide/svelte/icons/group';
	import HandIcon from '@lucide/svelte/icons/hand';
	import ImageIcon from '@lucide/svelte/icons/image';
	import ImagesIcon from '@lucide/svelte/icons/images';
	import InfoIcon from '@lucide/svelte/icons/info';
	import LassoSelectIcon from '@lucide/svelte/icons/lasso-select';
	import LaughIcon from '@lucide/svelte/icons/laugh';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import MagnetIcon from '@lucide/svelte/icons/magnet';
	import MousePointer2Icon from '@lucide/svelte/icons/mouse-pointer-2';
	import MoveIcon from '@lucide/svelte/icons/move';
	import ErrorIcon from '@lucide/svelte/icons/octagon-x';
	import PaintBucketIcon from '@lucide/svelte/icons/paint-bucket';
	import PanelsTopLeftIcon from '@lucide/svelte/icons/panels-top-left';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PipetteIcon from '@lucide/svelte/icons/pipette';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RadioIcon from '@lucide/svelte/icons/radio';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import ScanLineIcon from '@lucide/svelte/icons/scan-line';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import SendToBackIcon from '@lucide/svelte/icons/send-to-back';
	import ShapesIcon from '@lucide/svelte/icons/shapes';
	import ShuffleIcon from '@lucide/svelte/icons/shuffle';
	import SkipBackIcon from '@lucide/svelte/icons/skip-back';
	import SkipForwardIcon from '@lucide/svelte/icons/skip-forward';
	import SquareDashedMousePointerIcon from '@lucide/svelte/icons/square-dashed-mouse-pointer';
	import SquareIcon from '@lucide/svelte/icons/square';
	import StickerIcon from '@lucide/svelte/icons/sticker';
	import TypeIcon from '@lucide/svelte/icons/type';
	import UngroupIcon from '@lucide/svelte/icons/ungroup';
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
			'editor-keyframe': DiamondIcon,
			'editor-marker': FlagIcon,
			'editor-speed': GaugeIcon,
			'editor-loop': RepeatIcon,
			'editor-shuffle': ShuffleIcon,
			'editor-skip-back': SkipBackIcon,
			'editor-skip-forward': SkipForwardIcon,
			'editor-upscale': ScanLineIcon,
			'editor-align-top': AlignStartHorizontalIcon,
			'editor-align-bottom': AlignEndHorizontalIcon,
			'editor-align-left': AlignStartVerticalIcon,
			'editor-align-right': AlignEndVerticalIcon,
			'editor-align-center-horizontal': AlignCenterHorizontalIcon,
			'editor-align-center-vertical': AlignCenterVerticalIcon,
			'editor-distribute-horizontal': AlignHorizontalDistributeCenterIcon,
			'editor-distribute-vertical': AlignVerticalDistributeCenterIcon,
			'editor-arrange-front': BringToFrontIcon,
			'editor-arrange-back': SendToBackIcon,
			'editor-group': GroupIcon,
			'editor-ungroup': UngroupIcon,
			'editor-combine': CombineIcon,
			'editor-layers': LayersIcon,
			'editor-flip-horizontal': FlipHorizontal2Icon,
			'editor-flip-vertical': FlipVertical2Icon,
			'editor-rotate-left': RotateCcwIcon,
			'editor-rotate-right': RotateCwIcon,
			'editor-crop': CropIcon,
			'editor-select': MousePointer2Icon,
			'editor-lasso': LassoSelectIcon,
			'editor-marquee': SquareDashedMousePointerIcon,
			'editor-marquee-ellipse': CircleDashedIcon,
			'editor-pan': HandIcon,
			'editor-snap': MagnetIcon,
			'editor-eyedropper': PipetteIcon,
			'editor-fill': PaintBucketIcon,
			'editor-blend': BlendIcon,
			'editor-erase': EraserIcon,
			'editor-emoji': LaughIcon,
			'editor-focus': CrosshairIcon,
			'editor-compare': Columns2Icon,
			'editor-solo': RadioIcon,
			'editor-stop': SquareIcon,
			'editor-paint': BrushIcon,
			pending: CircleDashedIcon,
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
