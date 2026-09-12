import { toast, type ExternalToast } from 'svelte-sonner';

export type ToastTone = 'neutral' | 'success' | 'error' | 'info' | 'warning';

export function showToast(
	message: string,
	tone: ToastTone = 'neutral',
	options?: { actionLabel?: string; onAction?: () => void; position?: ExternalToast['position'] }
) {
	const data: ExternalToast = {};
	if (options?.position) data.position = options.position;
	if (options?.actionLabel && options.onAction) {
		data.action = { label: options.actionLabel, onClick: options.onAction };
	}
	return tone === 'success'
		? toast.success(message, data)
		: tone === 'error'
			? toast.error(message, data)
			: tone === 'info'
				? toast.info(message, data)
				: tone === 'warning'
					? toast.warning(message, data)
					: toast(message, data);
}

export function dismissToast(id?: string | number): void {
	toast.dismiss(id);
}
