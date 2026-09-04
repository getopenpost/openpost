import {
	availableThemeQueryOptions,
	availableThemesQueryOptions,
	builtInThemesQueryOptions,
	organizationThemeQueryOptions,
	organizationThemesQueryOptions,
	resolvedThemeQueryOptions,
	themeAssetsQueryOptions,
	themeRevisionsQueryOptions,
	themeSettingsQueryOptions,
	type ThemeQueryAPI
} from '@openpost/query-catalog';
import { client } from '$lib/api/client';
import { queryGET } from './transport';

type QueryTransport = Pick<typeof client, 'GET'>;

/**
 * Web transport for the shared themes domain. Every read is a cache-safe
 * GET routed through the central query transport; writes stay on the
 * caller and reconcile the cache through themeMutationCachePlan.
 */
interface ThemeLibraryQuery {
	organization_id: string;
	cursor?: string;
}

interface AvailableThemeQuery {
	workspace_id: string;
	limit: 100;
	cursor?: string;
}

function themeLibraryQuery(organizationId: string, cursor: string): ThemeLibraryQuery {
	const query: ThemeLibraryQuery = {
		organization_id: organizationId
	};
	if (cursor) query.cursor = cursor;
	return query;
}

function availableThemeQuery(workspaceId: string, cursor: string): AvailableThemeQuery {
	const query: AvailableThemeQuery = { workspace_id: workspaceId, limit: 100 };
	if (cursor) query.cursor = cursor;
	return query;
}

export function createThemeQueryAPI(transport: QueryTransport = client): ThemeQueryAPI {
	return {
		async listBuiltInThemes(signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load built-in themes',
				request: (requestSignal) => transport.GET('/themes/built-ins', { signal: requestSignal })
			});
			return data ?? [];
		},
		async listOrganizationThemes(workspaceId, organizationId, cursor, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load the theme library',
				request: (requestSignal) =>
					transport.GET('/themes', {
						params: {
							query: themeLibraryQuery(organizationId, cursor)
						},
						signal: requestSignal
					})
			});
			return data ?? { items: [], next_cursor: null };
		},
		async getOrganizationTheme(workspaceId, organizationId, themeId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load this theme',
				request: (requestSignal) =>
					transport.GET('/themes/{id}', {
						params: { path: { id: themeId }, query: { organization_id: organizationId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listAvailableThemes(workspaceId, signal) {
			const items = [];
			const visitedCursors = new Set<string>();
			let cursor = '';
			do {
				const { data } = await queryGET({
					signal,
					fallback: 'Unable to load available themes',
					request: (requestSignal) =>
						transport.GET('/themes/available', {
							params: { query: availableThemeQuery(workspaceId, cursor) },
							signal: requestSignal
						})
				});
				const page = data ?? { items: [], next_cursor: null };
				items.push(...page.items);
				const nextCursor = page.next_cursor?.trim() ?? '';
				if (nextCursor && visitedCursors.has(nextCursor)) {
					throw new Error('Unable to load available themes: pagination cursor repeated');
				}
				if (nextCursor) visitedCursors.add(nextCursor);
				cursor = nextCursor;
			} while (cursor);
			return { items, next_cursor: null };
		},
		async getAvailableCustomTheme(workspaceId, themeId, revision, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load this theme preview',
				request: (requestSignal) =>
					transport.GET('/themes/available/{id}', {
						params: {
							path: { id: themeId },
							query: { workspace_id: workspaceId, revision }
						},
						signal: requestSignal
					})
			});
			return data;
		},
		async resolveTheme(workspaceId, scheme, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to resolve the workspace theme',
				request: (requestSignal) =>
					transport.GET('/themes/resolved', {
						params: { query: { workspace_id: workspaceId, scheme } },
						signal: requestSignal
					})
			});
			return data;
		},
		async getThemeSettings(workspaceId, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load theme settings',
				request: (requestSignal) =>
					transport.GET('/theme-settings', {
						params: { query: { workspace_id: workspaceId } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listThemeRevisions(workspaceId, organizationId, themeId, cursor, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load theme revisions',
				request: (requestSignal) =>
					transport.GET('/themes/{id}/revisions', {
						params: {
							path: { id: themeId },
							query: themeLibraryQuery(organizationId, cursor)
						},
						signal: requestSignal
					})
			});
			return data ?? { items: [], next_cursor: null };
		},
		async getThemeRevision(workspaceId, themeId, revision, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load this revision',
				request: (requestSignal) =>
					transport.GET('/themes/{id}/revisions/{revision}', {
						params: { path: { id: themeId, revision } },
						signal: requestSignal
					})
			});
			return data;
		},
		async listThemeAssets(workspaceId, organizationId, cursor, signal) {
			const { data } = await queryGET({
				signal,
				fallback: 'Unable to load theme assets',
				request: (requestSignal) =>
					transport.GET('/theme-assets', {
						params: {
							query: themeLibraryQuery(organizationId, cursor)
						},
						signal: requestSignal
					})
			});
			return data ?? { items: [], next_cursor: null };
		}
	};
}

export const themeQueryAPI = createThemeQueryAPI(client);

export function themeBuiltInThemesOptions() {
	return builtInThemesQueryOptions(themeQueryAPI);
}
export function themeOrganizationThemesOptions(
	workspaceID: string,
	organizationID: string,
	cursor = ''
) {
	return organizationThemesQueryOptions(themeQueryAPI, workspaceID, organizationID, cursor);
}
export function themeOrganizationThemeOptions(
	workspaceID: string,
	organizationID: string,
	themeID: string
) {
	return organizationThemeQueryOptions(themeQueryAPI, workspaceID, organizationID, themeID);
}
export function themeAvailableThemesOptions(workspaceID: string) {
	return availableThemesQueryOptions(themeQueryAPI, workspaceID);
}
export function themeAvailableThemeOptions(workspaceID: string, themeID: string, revision: number) {
	return availableThemeQueryOptions(themeQueryAPI, workspaceID, themeID, revision);
}
export function themeResolvedOptions(workspaceID: string, scheme: ResolvedThemeScheme) {
	return resolvedThemeQueryOptions(themeQueryAPI, workspaceID, scheme);
}
export function themeSettingsOptions(workspaceID: string) {
	return themeSettingsQueryOptions(themeQueryAPI, workspaceID);
}
export function themeRevisionsOptions(
	workspaceID: string,
	organizationID: string,
	themeID: string,
	cursor = ''
) {
	return themeRevisionsQueryOptions(themeQueryAPI, workspaceID, organizationID, themeID, cursor);
}
export function themeAssetsOptions(workspaceID: string, organizationID: string, cursor = '') {
	return themeAssetsQueryOptions(themeQueryAPI, workspaceID, organizationID, cursor);
}
