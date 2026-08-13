import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException } from '@openpost/telemetry';

export const handleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;
	captureClientException(error, { error_boundary: 'sveltekit', status });
};
