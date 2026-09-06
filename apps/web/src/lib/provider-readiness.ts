export type ProviderReadinessState =
	| 'healthy'
	| 'unsupported'
	| 'disabled'
	| 'needs_configuration'
	| 'reconnect_required'
	| 'degraded'
	| 'approval_required'
	| 'trial_only'
	| 'policy_restricted'
	| 'certification_required'
	| 'expired_proof';

export type ProviderReadinessAction =
	| 'none'
	| 'configure'
	| 'reconnect'
	| 'retry'
	| 'contact_admin';

export type ProviderReadinessDecision = {
	state?: string;
	connectable?: boolean;
	publishable?: boolean;
	blockers?: Array<{ code: string; detail?: string }> | null;
};

export type ProviderReadinessPresentation = {
	state: ProviderReadinessState;
	quiet: boolean;
	canProceed: boolean;
	action: ProviderReadinessAction;
	tone: 'neutral' | 'warning' | 'error';
	blockerCodes: string[];
};

export type ProviderReadinessOperation = 'connect' | 'publish_immediate' | 'publish_scheduled';

export function presentProviderReadiness(
	decision: ProviderReadinessDecision | null | undefined,
	operation: ProviderReadinessOperation
): ProviderReadinessPresentation {
	if (!decision) return unavailablePresentation();
	const state = normalizeState(decision.state);
	const canProceed =
		operation === 'connect' ? decision.connectable === true : decision.publishable === true;
	if (state === 'healthy' && canProceed) {
		return {
			state,
			quiet: true,
			canProceed: true,
			action: 'none',
			tone: 'neutral',
			blockerCodes: []
		};
	}
	if (state === 'healthy') return unavailablePresentation();
	const blockerCodes = (decision.blockers ?? []).map((blocker) => blocker.code).filter(Boolean);
	return {
		state,
		quiet: false,
		canProceed,
		action: canProceed ? 'none' : actionForState(state, blockerCodes),
		tone: toneForState(state),
		blockerCodes
	};
}

function normalizeState(value: string | undefined): ProviderReadinessState {
	switch (value) {
		case 'healthy':
		case 'unsupported':
		case 'disabled':
		case 'needs_configuration':
		case 'reconnect_required':
		case 'degraded':
		case 'approval_required':
		case 'trial_only':
		case 'policy_restricted':
		case 'certification_required':
		case 'expired_proof':
			return value;
		default:
			return 'degraded';
	}
}

function actionForState(
	state: ProviderReadinessState,
	blockerCodes: string[]
): ProviderReadinessAction {
	switch (state) {
		case 'needs_configuration':
			return 'configure';
		case 'reconnect_required':
			return 'reconnect';
		case 'degraded':
			return blockerCodes.includes('readiness_evidence_unavailable') ? 'retry' : 'contact_admin';
		case 'approval_required':
		case 'trial_only':
		case 'policy_restricted':
		case 'certification_required':
		case 'expired_proof':
		case 'disabled':
			return 'contact_admin';
		case 'healthy':
		case 'unsupported':
		default:
			return 'none';
	}
}

function toneForState(state: ProviderReadinessState): 'neutral' | 'warning' | 'error' {
	switch (state) {
		case 'unsupported':
			return 'neutral';
		case 'needs_configuration':
		case 'reconnect_required':
		case 'approval_required':
		case 'trial_only':
		case 'certification_required':
		case 'expired_proof':
			return 'warning';
		default:
			return 'error';
	}
}

function unavailablePresentation(): ProviderReadinessPresentation {
	return {
		state: 'degraded',
		quiet: false,
		canProceed: false,
		action: 'retry',
		tone: 'error',
		blockerCodes: ['readiness_evidence_unavailable']
	};
}
