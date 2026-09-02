<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import InfoIcon from '@lucide/svelte/icons/info';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import ErrorIcon from '@lucide/svelte/icons/octagon-x';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import WarningIcon from '@lucide/svelte/icons/triangle-alert';
	import type { SVGAttributes } from 'svelte/elements';
	import type { ProtectedIconRole } from './protected-icon.js';

	type Props = Omit<SVGAttributes<SVGSVGElement>, 'role'> & {
		icon: ProtectedIconRole;
		label?: string;
	};

	let { icon, label, ...restProps }: Props = $props();
	const Icon = $derived(
		{
			error: ErrorIcon,
			info: InfoIcon,
			loading: LoaderIcon,
			pause: PauseIcon,
			play: PlayIcon,
			success: CircleCheckIcon,
			warning: WarningIcon
		}[icon]
	);
</script>

<Icon
	{...restProps}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	data-protected-icon={icon}
/>
