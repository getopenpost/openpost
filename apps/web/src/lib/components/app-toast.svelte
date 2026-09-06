<script lang="ts">
	import { toast } from 'svelte-sonner';

	interface Props {
		message: string;
		onDismiss: () => void;
		dismissLabel: string;
		tone?: 'neutral' | 'success' | 'error';
		actionLabel?: string;
		actionHref?: string;
		onAction?: () => void;
	}

	let {
		message,
		onDismiss,
		dismissLabel: _dismissLabel,
		tone = 'neutral',
		actionLabel,
		actionHref,
		onAction
	}: Props = $props();

	$effect(() => {
		const action = actionLabel
			? {
					label: actionLabel,
					onClick: () => {
						if (actionHref) window.location.assign(actionHref);
						else onAction?.();
						onDismiss();
					}
				}
			: undefined;
		const data = {
			action,
			closeButton: true,
			onDismiss,
			duration: tone === 'error' ? Infinity : undefined
		};
		const id =
			tone === 'success'
				? toast.success(message, data)
				: tone === 'error'
					? toast.error(message, data)
					: toast(message, data);
		return () => toast.dismiss(id);
	});
</script>
