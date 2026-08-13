import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import {
	billingPeriodFromSearchParams,
	hostedPlanFromSearchParams,
	type BillingPeriod,
	type HostedPlanID
} from '$lib/billing';

export const purchaseChoiceParam = 'purchase_choice';

export type PurchaseChoice = components['schemas']['PurchaseChoiceResponse'];
export type PurchaseSelection = Pick<PurchaseChoice, 'plan_id' | 'billing_period' | 'token'>;
type APIError = components['schemas']['ErrorModel'];
export type PurchaseChoiceErrorCode =
	'missing' | 'invalid' | 'expired' | 'mismatch' | 'unavailable';

export interface PurchaseChoiceResult {
	choice?: PurchaseChoice;
	error?: string;
	errorCode?: PurchaseChoiceErrorCode;
}

export function purchaseSelection(
	searchParams: URLSearchParams
):
	| { planID: HostedPlanID; billingPeriod: BillingPeriod; token: string }
	| { errorCode: 'missing' | 'invalid' } {
	const rawPlan = searchParams.get('plan');
	const rawPeriod = searchParams.get('billing_period');
	if (!rawPlan || !rawPeriod) return { errorCode: 'missing' };
	const planID = hostedPlanFromSearchParams(searchParams);
	const billingPeriod = billingPeriodFromSearchParams(searchParams);
	if (!planID || !billingPeriod) return { errorCode: 'invalid' };
	return {
		planID,
		billingPeriod,
		token: searchParams.get(purchaseChoiceParam)?.trim() ?? ''
	};
}

export async function resolvePurchaseChoice(
	searchParams: URLSearchParams
): Promise<PurchaseChoiceResult> {
	const selection = purchaseSelection(searchParams);
	if ('errorCode' in selection) return { errorCode: selection.errorCode };
	const { data, error } = await client.POST('/billing/purchase-choice', {
		body: {
			plan_id: selection.planID,
			billing_period: selection.billingPeriod,
			purchase_choice_token: selection.token || undefined
		}
	});
	if (error || !data) {
		const detail = error?.detail ?? '';
		return { error: detail, errorCode: purchaseChoiceErrorCode(error ?? {}) };
	}
	return { choice: data };
}

export function purchaseChoiceErrorCode(
	error: Partial<Pick<APIError, 'type' | 'detail'>>
): PurchaseChoiceErrorCode {
	switch (error.type) {
		case 'urn:openpost:problem:purchase-choice:missing':
			return 'missing';
		case 'urn:openpost:problem:purchase-choice:invalid':
			return 'invalid';
		case 'urn:openpost:problem:purchase-choice:expired':
			return 'expired';
		case 'urn:openpost:problem:purchase-choice:mismatch':
			return 'mismatch';
		default:
			return 'unavailable';
	}
}

export function applyPurchaseChoice(target: URL, choice: PurchaseSelection): URL {
	target.searchParams.set('plan', choice.plan_id);
	target.searchParams.set('billing_period', choice.billing_period);
	target.searchParams.set(purchaseChoiceParam, choice.token);
	return target;
}

export function copyPurchaseChoice(source: URLSearchParams, target: URLSearchParams): void {
	for (const key of ['plan', 'billing_period', purchaseChoiceParam]) {
		const value = source.get(key);
		if (value) target.set(key, value);
	}
}
