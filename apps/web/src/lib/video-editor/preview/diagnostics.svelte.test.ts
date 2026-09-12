import { expect, test } from 'vitest';
import { previewDiagnostics } from './diagnostics.svelte';

test('reverse playback skips appear in diagnostics and reset with the counters', () => {
	previewDiagnostics.resetCounters();
	previewDiagnostics.recordReverseWindowSkip();
	expect(previewDiagnostics.snapshot.reverseWindowSkips).toBe(1);
	previewDiagnostics.resetCounters();
	expect(previewDiagnostics.snapshot.reverseWindowSkips).toBe(0);
});
