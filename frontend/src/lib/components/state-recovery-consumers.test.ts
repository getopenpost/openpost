import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const accountSource = read('./account-management.svelte');
const scheduleSource = read('./settings/ScheduleSettingsTab.svelte');
const developerSource = read('./settings/DeveloperSettingsTab.svelte');
const securitySource = read('./settings/SecuritySettingsTab.svelte');
const mediaSource = read('../../routes/media/+page.svelte');
const promptsSource = read('../../routes/prompts/+page.svelte');
const sidebarSource = read('./sidebar-planner.svelte');
const videoEditorSource = read('../../routes/video-editor/+page.svelte');

describe('loaded-context recovery consumers', () => {
	it('retains media and prompt results while same-query retries are pending or fail', () => {
		expect(mediaSource).not.toContain('error = (e as Error).message;\n\t\t\tmediaItems = [];');
		expect(mediaSource).toContain('if (loadedMediaViewKey !== requestKey) {');
		expect(mediaSource).toContain('loadedMediaViewKey = requestKey;');
		for (const viewField of [
			'lifecycleView',
			'filter',
			'sort',
			'appliedSearch',
			'mediaType',
			'source',
			'selectedTagIDs',
			'showUntagged',
			'aspect',
			'minWidth',
			'minHeight',
			'maxWidth',
			'maxHeight',
			'dateFrom',
			'dateTo',
			'currentPage'
		]) {
			expect(
				mediaSource.slice(
					mediaSource.indexOf('function mediaViewKey'),
					mediaSource.indexOf('async function loadWorkspaces')
				)
			).toContain(viewField);
		}
		expect(promptsSource).toContain('if (queryChanged) {');
		expect(promptsSource).not.toContain(
			'error = (e as Error).message || m.prompts_load_failed();\n\t\t\tprompts = [];'
		);
		expect(promptsSource).toContain('{#if loading && prompts.length > 0}');
	});

	it('retains sidebar drafts with an in-place retry after API and network failures', () => {
		expect(sidebarSource).toContain('throw new Error(publicationResult.error.detail');
		expect(sidebarSource).toContain('draftsError =');
		expect(sidebarSource).toContain('onclick={() => void loadDrafts(workspaceId)}');
		expect(sidebarSource).toContain('{:else if !draftsError && drafts.length === 0}');
		expect(sidebarSource).not.toContain('const publications = publicationResult.error ? []');
	});

	it('keeps local video editor state available when cloud projects fail', () => {
		const initialize = videoEditorSource.slice(
			videoEditorSource.indexOf('async function initialize'),
			videoEditorSource.indexOf('async function openFiles')
		);
		expect(initialize).toContain('recentProjects = localProjects;');
		expect(initialize).toContain(
			'if ($auth.isAuthenticated) await loadCloudProjects(localProjects, true);'
		);
		expect(initialize).toContain('cloudLoadError =');
		const cloudLoad = initialize.slice(initialize.indexOf('async function loadCloudProjects'));
		expect(cloudLoad).not.toContain('loadError =');
		expect(videoEditorSource).toContain(
			'onclick={() => void loadCloudProjects(recentProjects, true)}'
		);
		expect(videoEditorSource).toContain('{:else if cloudProjects.length === 0 && !cloudLoadError}');
	});

	it('clears account and schedule results only when their owning workspace changes', () => {
		expect(accountSource).toContain('if (workspaceChanged) accounts = [];');
		expect(accountSource).not.toContain(
			'e instanceof Error && e.message ? e.message : m.accounts_providers_load_failed();\n\t\t\tproviderEntries = [];'
		);
		expect(accountSource).toContain('{#if accountsLoading && accounts.length === 0}');
		expect(accountSource).toContain('{#if providersLoading && providerEntries.length === 0}');
		expect(scheduleSource).toContain('if (workspaceChanged) schedules = [];');
		expect(scheduleSource).not.toContain("loadedScheduleWorkspaceID = '';\n\t\t\tschedules = [];");
		expect(scheduleSource).toContain('{#if loadingSchedules && scheduleRows.length === 0}');
	});

	it('retains secondary settings collections when their refresh fails', () => {
		expect(developerSource).not.toContain(
			'mcpActivityError = (e as Error).message;\n\t\t\tmcpActivity = [];'
		);
		expect(developerSource).not.toContain(
			'apiTokensLoadError = (e as Error).message;\n\t\t\tif (loadedAPITokensUserID === userID)'
		);
		expect(developerSource).toContain('{#if mcpActivityLoading && mcpActivity.length === 0}');
		expect(securitySource).not.toContain(
			'catch (e) {\n\t\t\tauthSessions = [];\n\t\t\tauthSessionsError'
		);
		expect(securitySource).toContain('{#if authSessionsLoading && authSessions.length === 0}');
	});
});
