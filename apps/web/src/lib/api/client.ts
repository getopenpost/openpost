import createClient from 'openapi-fetch';
import type { paths, components } from './types';
import { feedbackDiagnostics } from '$lib/feedback-diagnostics';
import { applyTelemetryRequestHeaders } from '@openpost/telemetry';

// Re-export schema types for convenience
export type User = components['schemas']['UserProfile'];
export type Workspace = components['schemas']['WorkspaceResponse'];
export type SocialAccount = components['schemas']['AccountResponse'];
export type ProviderInfo = components['schemas']['ProviderInfo'];
export type AuthConfiguration = components['schemas']['AuthConfigurationOutputBody'];
export type AccountDeletionImpact = components['schemas']['AccountDeletionImpact'];
export type OIDCProvider = components['schemas']['OIDCProviderSummary'];
export type PublicProfile = components['schemas']['PublicProfileOutputBody'];

export function applyAPIRequestHeaders(headers: Headers): Headers {
	applyTelemetryRequestHeaders(headers);
	return headers;
}

function createApiClient() {
	const c = createClient<paths>({ baseUrl: '/api/v1', credentials: 'include' });
	c.use({
		async onRequest({ request }) {
			feedbackDiagnostics.recordRequestStart(request);
			applyAPIRequestHeaders(request.headers);
			return request;
		},
		async onResponse({ request, response }) {
			feedbackDiagnostics.recordResponse(request, response);
			return response;
		}
	});
	return c;
}

type APIClient = ReturnType<typeof createApiClient>;
type APIClientMethods = Pick<APIClient, 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>;

const rawClient = createApiClient();

export const client: APIClientMethods = {
	get GET() {
		return rawClient.GET.bind(rawClient);
	},
	get POST() {
		return rawClient.POST.bind(rawClient);
	},
	get PUT() {
		return rawClient.PUT.bind(rawClient);
	},
	get PATCH() {
		return rawClient.PATCH.bind(rawClient);
	},
	get DELETE() {
		return rawClient.DELETE.bind(rawClient);
	}
};
