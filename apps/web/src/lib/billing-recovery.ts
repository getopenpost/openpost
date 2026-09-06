import type { components } from '$lib/api/types';

export type BillingPortalPurpose = components['schemas']['CreateBillingPortalInputBody']['purpose'];

export interface BillingRecoveryStatus {
	workspace_id: string;
	status: string;
	can_manage_billing: boolean;
	access_restricted: boolean;
	past_due_since?: string;
}

export function requiresBillingRecovery(status: BillingRecoveryStatus | null | undefined): boolean {
	return Boolean(status?.access_restricted && status.status.toLowerCase() === 'past_due');
}

interface BillingRecoveryPayload {
	workspace_id?: unknown;
	status?: unknown;
	can_manage_billing?: unknown;
	access_restricted?: unknown;
	past_due_since?: unknown;
}

export function parseBillingRecoveryStatus(value: unknown): BillingRecoveryStatus | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	// SAFETY: The parser validates every field from this JSON object before returning a BillingRecoveryStatus.
	const payload = value as BillingRecoveryPayload;
	if (
		typeof payload.workspace_id !== 'string' ||
		!payload.workspace_id ||
		typeof payload.status !== 'string' ||
		!payload.status ||
		typeof payload.can_manage_billing !== 'boolean' ||
		typeof payload.access_restricted !== 'boolean' ||
		(payload.past_due_since !== undefined && typeof payload.past_due_since !== 'string')
	) {
		return null;
	}
	return {
		workspace_id: payload.workspace_id,
		status: payload.status,
		can_manage_billing: payload.can_manage_billing,
		access_restricted: payload.access_restricted,
		past_due_since: payload.past_due_since
	};
}

export function billingPortalBody(workspaceID: string, purpose: BillingPortalPurpose = 'manage') {
	return { workspace_id: workspaceID, purpose };
}
