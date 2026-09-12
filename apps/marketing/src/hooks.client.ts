import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException } from '@openpost/telemetry';
import { installStaleModuleRecovery } from './lib/stale-module-recovery';

export function init() {
	// Page imports can fail before the root layout mounts during hydration.
	installStaleModuleRecovery();
}

export const handleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;
	captureClientException(error, { error_boundary: 'sveltekit', status });
};
