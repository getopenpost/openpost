import type { ChunkRecoveryDecision } from '@openpost/telemetry';

export async function captureIfUnrecovered(
	error: unknown,
	recover: (error: unknown) => Promise<ChunkRecoveryDecision>,
	capture: (error: unknown) => void
): Promise<void> {
	try {
		const decision = await recover(error);
		if (decision.kind === 'reloaded') return;
	} catch {
		// A failed recovery check still needs the original error report.
	}
	capture(error);
}
