import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException, installGlobalErrorCapture } from '@openpost/telemetry';

export async function init() {
	installGlobalErrorCapture();
}

export const handleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;
	captureClientException(error, { error_boundary: 'sveltekit', status });
};
