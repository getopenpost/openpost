import type { ChunkRecoveryDecision } from '@openpost/telemetry';

export async function captureIfUnrecovered(
	cause: unknown,
	recover: (cause: unknown) => Promise<ChunkRecoveryDecision>,
	capture: (cause: unknown) => void
): Promise<void> {
	try {
		const decision = await recover(cause);
		if (decision.kind === 'reloaded') return;
	} catch {
		// A failed recovery check still needs the original error report.
	}
	capture(cause);
}
