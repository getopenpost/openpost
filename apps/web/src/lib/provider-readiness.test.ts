import { describe, expect, it } from 'vitest';
import { presentProviderReadiness } from './provider-readiness';

describe('presentProviderReadiness', () => {
	it('keeps a healthy decision quiet', () => {
		expect(presentProviderReadiness({ state: 'healthy', connectable: true }, 'connect')).toEqual({
			state: 'healthy',
			quiet: true,
			canProceed: true,
			action: 'none',
			tone: 'neutral',
			blockerCodes: []
		});
	});

	it.each([
		['needs_configuration', 'configure'],
		['reconnect_required', 'reconnect'],
		['approval_required', 'contact_admin'],
		['disabled', 'contact_admin']
	] as const)('maps %s to an actionable blocked state', (state, action) => {
		const presentation = presentProviderReadiness(
			{ state, publishable: false, blockers: [{ code: state }] },
			'publish_scheduled'
		);
		expect(presentation).toMatchObject({ state, canProceed: false, quiet: false, action });
	});

	it('fails closed with a retry action when evidence is absent', () => {
		expect(presentProviderReadiness(undefined, 'publish_immediate')).toMatchObject({
			state: 'degraded',
			canProceed: false,
			action: 'retry',
			blockerCodes: ['readiness_evidence_unavailable']
		});
	});

	it('distinguishes a failed evidence lookup from an operator-degraded control', () => {
		expect(
			presentProviderReadiness(
				{
					state: 'degraded',
					publishable: false,
					blockers: [{ code: 'readiness_evidence_unavailable' }]
				},
				'publish_immediate'
			)
		).toMatchObject({ action: 'retry' });
		expect(
			presentProviderReadiness(
				{ state: 'degraded', publishable: false, blockers: [{ code: 'degraded' }] },
				'publish_immediate'
			)
		).toMatchObject({ action: 'contact_admin' });
	});

	it('does not trust a healthy label without the operation boolean', () => {
		expect(
			presentProviderReadiness({ state: 'healthy', publishable: false }, 'publish_immediate')
		).toMatchObject({ state: 'degraded', canProceed: false, action: 'retry' });
	});
});
