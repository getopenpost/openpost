import createClient from 'openapi-fetch';
import type { paths, components } from './types';
import { getApiBase } from '$lib/stores/instance.svelte';
import { feedbackDiagnostics } from '$lib/feedback-diagnostics';

// Re-export schema types for convenience
export type User = components['schemas']['UserProfile'];
export type Workspace = components['schemas']['WorkspaceResponse'];
export type Post = components['schemas']['PostResponse'];
export type SocialAccount = components['schemas']['AccountResponse'];
export type ProviderInfo = components['schemas']['ProviderInfo'];
export type ScheduleOverview = components['schemas']['ScheduleOverviewOutputBody'];
export type AuthResponse = components['schemas']['AuthOutputBody'];
export type AuthConfiguration = components['schemas']['AuthConfigurationOutputBody'];
export type AccountDeletionImpact = components['schemas']['AccountDeletionImpact'];

let token: string | null = null;

export function setToken(newToken: string | null | undefined) {
	token = newToken ?? null;
}

export function getToken(): string | null {
	return token;
}

function createApiClient() {
	const c = createClient<paths>({ baseUrl: getApiBase(), credentials: 'include' });
	c.use({
		async onRequest({ request }) {
			feedbackDiagnostics.recordRequestStart(request);
			if (token) {
				request.headers.set('Authorization', `Bearer ${token}`);
			}
			return request;
		},
		async onResponse({ request, response }) {
			feedbackDiagnostics.recordResponse(request, response);
			return response;
		}
	});
	return c;
}

let rawClient = createApiClient();

export function recreateClient() {
	rawClient = createApiClient();
}

export const client = new Proxy(rawClient, {
	get(_target, prop) {
		const val = Reflect.get(rawClient, prop, rawClient);
		if (typeof val === 'function') {
			return val.bind(rawClient);
		}
		return val;
	}
});
