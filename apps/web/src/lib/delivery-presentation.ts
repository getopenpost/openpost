import type { components } from '$lib/api/types';
import { m } from '$lib/paraglide/messages';

export type DeliveryRecoveryAction =
	components['schemas']['ProviderDeliveryResponse']['recovery_action'];

export type DeliveryPresentation = {
	state?: string;
	recovery_action?: DeliveryRecoveryAction;
};

export function deliveryStateLabel(state: string) {
	if (state === 'queued') return m.publication_delivery_queued();
	if (state === 'submitted') return m.publication_delivery_submitted();
	if (state === 'processing') return m.publication_delivery_processing();
	if (state === 'provider_scheduled') return m.publication_delivery_provider_scheduled();
	if (state === 'live') return m.publication_delivery_live();
	if (state === 'rejected') return m.publication_delivery_rejected();
	if (state === 'ambiguous') return m.publication_delivery_ambiguous();
	if (state === 'manual_resolution') return m.publication_delivery_manual_resolution();
	if (state === 'published' || state === 'success') return m.activity_status_published();
	if (state === 'publishing') return m.activity_status_publishing();
	if (state === 'failed') return m.activity_status_failed();
	if (state === 'scheduled') return m.activity_status_scheduled();
	if (state === 'draft') return m.activity_status_draft();
	if (state === 'skipped') return m.activity_destination_skipped();
	return state || m.activity_destination_pending();
}

export function deliveryRecoveryAction(
	delivery: DeliveryPresentation | undefined,
	renditionStatus: string
): DeliveryRecoveryAction {
	if (delivery?.recovery_action === 'retry') {
		return renditionStatus === 'failed' ? 'retry' : 'none';
	}
	if (delivery?.recovery_action === 'reconcile') return 'reconcile';
	if (delivery?.recovery_action === 'manual_resolution') return 'manual_resolution';
	return 'none';
}

export function deliveryStatusClass(state: string) {
	if (state === 'live' || state === 'published' || state === 'success') {
		return 'text-emerald-800 dark:text-emerald-300';
	}
	if (state === 'rejected' || state === 'failed' || state === 'manual_resolution') {
		return 'text-destructive';
	}
	if (state === 'queued' || state === 'submitted' || state === 'processing') {
		return 'text-blue-700 dark:text-blue-300';
	}
	return 'text-muted-foreground';
}
