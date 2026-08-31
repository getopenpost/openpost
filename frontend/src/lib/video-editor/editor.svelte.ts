/**
 * Editor session: binds one project to the timeline store, media pool,
 * and autosave. One instance per open editor route.
 *
 * Playback uses the preview Clock; frame changes update the timeline store's
 * currentFrame so all panels stay in sync.
 */

import { createLogger } from './workspace-fs/logger';
import { getMediaForProject } from './workspace-fs/project-media';
import { updateProject } from './workspace-fs/projects';
import { getProject } from './workspace-fs/projects';
import type { AnimationPreset, Project } from './project/types';
import { cloneAnimationPreset, normalizeAnimationPresets } from './project/animation-presets';
import { timelineStore } from './timeline/stores/timeline-store.svelte';
import { commandHistory } from './timeline/commands/command-store.svelte';
import { Clock } from './preview/clock';
import { mediaPool } from './media/pool.svelte';
import { sceneBrowser } from './media/scene-search/scene-browser.svelte';
import { sequenceStore } from './sequences/sequence-store.svelte';
import { editorSettings } from './settings/editor-settings.svelte';
import { mediaRecovery } from './media/media-recovery.svelte';
import { PeriodicAutosaveController } from './settings/periodic-autosave';
import { getNextShuttleRate, type ShuttleDirection } from './preview/shuttle';
import { unsupportedProjectSchemaVersion } from './project/project-editability';
import { m } from '$lib/paraglide/messages';

interface ReactiveTransportState {
	playing: boolean;
	rate: number;
	mode: 'normal' | 'shuttle';
}

const logger = createLogger('EditorSession');

class EditorSession {
	private projectState = $state<Project | null>(null);
	loading = $state(true);
	loadError = $state('');
	saving = $state(false);
	saveError = $state('');

	clock = new Clock({ fps: 30, canSeek: () => !timelineStore.seekLocked });
	private transport = $state<ReactiveTransportState>({
		playing: false,
		rate: 1,
		mode: 'normal'
	});

	private projectId: string | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private saveRequested = false;
	private saveLoop: Promise<void> | null = null;
	private readonly periodicAutosave = new PeriodicAutosaveController(
		() => timelineStore.isDirty,
		() => this.saveNow(),
		(error) => {
			this.saveError = error instanceof Error ? error.message : String(error);
			logger.error('periodic save failed', error);
		}
	);

	get project(): Project | null {
		if (!this.projectState) return null;
		return { ...this.projectState, metadata: sequenceStore.rootResolution };
	}

	set project(project: Project | null) {
		this.projectState = project;
		if (project) sequenceStore._setRootResolution(project.metadata);
	}

	constructor() {
		this.clock.on('framechange', (frame) => timelineStore._setCurrentFrame(frame));
		this.clock.on('play', () => (this.transport.playing = true));
		this.clock.on('pause', () => (this.transport.playing = false));
		this.clock.on('ratechange', () => (this.transport.rate = this.clock.playbackRate));
		this.clock.on('ended', () => {
			this.clock.setRate(1);
			this.transport.mode = 'normal';
		});
	}

	get isPlaying(): boolean {
		return this.transport.playing;
	}

	get playbackRate(): number {
		return this.transport.rate;
	}

	get transportMode(): 'normal' | 'shuttle' {
		return this.transport.mode;
	}

	get fps(): number {
		return this.project ? timelineStore.fps : 30;
	}

	async load(projectId: string): Promise<void> {
		if (this.projectId && this.projectId !== projectId) {
			try {
				await this.flushAutosave();
			} catch (error) {
				this.loadError = error instanceof Error ? error.message : String(error);
				return;
			}
		}
		this.stopAutosaveTimers();
		this.projectId = projectId;
		this.loading = true;
		this.loadError = '';
		this.saveError = '';
		this.saveRequested = false;
		try {
			sceneBrowser.reset();
			mediaPool.clear();
			mediaRecovery.reset();
			const project = await getProject(projectId);
			if (!project) {
				this.loadError = 'Project not found';
				return;
			}
			const unsupportedSchema = unsupportedProjectSchemaVersion(project);
			if (unsupportedSchema !== null) {
				this.project = null;
				this.loadError = m.video_editor_project_newer_schema({
					version: String(unsupportedSchema)
				});
				return;
			}
			this.project = {
				...project,
				animationPresets: normalizeAnimationPresets(project.animationPresets)
			};
			commandHistory.clearHistory();
			sequenceStore.load(project.timeline ?? { tracks: [], items: [] }, project.metadata);
			timelineStore._setSnapEnabled(editorSettings.snapByDefault);
			timelineStore._setMaxUndoHistory(editorSettings.maxUndoHistory);
			this.clock.setFps(project.metadata.fps);
			this.syncTimelineClock();
			const media = await getMediaForProject(projectId);
			mediaPool.loadAll(media);
			await mediaRecovery.scan(media, timelineStore.items);
			this.configurePeriodicAutosave();
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	syncTimelineClock(): void {
		this.clock.setFps(this.fps);
		this.clock.seek(timelineStore.currentFrame);
	}

	startPlayback(range?: { start: number; end: number; loop?: boolean }): void {
		this.transport.mode = 'normal';
		this.clock.setRate(1);
		this.clock.play(
			range ? { range: { start: range.start, end: range.end }, loop: range.loop } : undefined
		);
	}

	shuttlePlayback(
		direction: ShuttleDirection,
		range: { start: number; end: number; loop?: boolean }
	): void {
		const nextRate = this.clock.isPlaying
			? getNextShuttleRate(this.clock.playbackRate, direction)
			: direction;
		this.transport.mode = 'shuttle';
		this.clock.setRate(nextRate);
		if (!this.clock.isPlaying) {
			this.clock.play({
				range: { start: range.start, end: range.end },
				loop: range.loop
			});
		}
	}

	pausePlayback(): void {
		this.clock.pause();
		this.clock.setRate(1);
		this.transport.mode = 'normal';
	}

	stopPlayback(): void {
		this.pausePlayback();
		this.clock.seek(0);
	}

	scheduleAutosave(): void {
		if (!this.projectId) return;
		this.saveRequested = true;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.saveNow().catch(() => undefined);
		}, 800);
	}

	configurePeriodicAutosave(): void {
		if (!this.projectId) return;
		this.periodicAutosave.configure(editorSettings.autoSaveIntervalMinutes);
	}

	async flushAutosave(): Promise<void> {
		if (!this.saveRequested && !timelineStore.isDirty) return;
		await this.saveNow();
	}

	stopAutosaveTimers(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		this.periodicAutosave.stop();
	}

	saveAnimationPreset(preset: AnimationPreset): void {
		if (!this.project) return;
		const next = [
			...(this.project.animationPresets ?? []).filter((entry) => entry.id !== preset.id),
			cloneAnimationPreset(preset)
		].toSorted((left, right) => right.createdAt - left.createdAt);
		this.project = { ...this.project, animationPresets: next };
		this.scheduleAutosave();
	}

	deleteAnimationPreset(presetId: string): void {
		if (!this.project) return;
		const next = (this.project.animationPresets ?? []).filter((preset) => preset.id !== presetId);
		if (next.length === (this.project.animationPresets ?? []).length) return;
		this.project = { ...this.project, animationPresets: next };
		this.scheduleAutosave();
	}

	async saveNow(): Promise<void> {
		if (!this.projectId || !this.project) return;
		this.saveRequested = true;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = null;
		if (!this.saveLoop) {
			const loop = this.drainSaves();
			this.saveLoop = loop;
			void loop.then(
				() => {
					if (this.saveLoop === loop) this.saveLoop = null;
				},
				() => {
					if (this.saveLoop === loop) this.saveLoop = null;
				}
			);
		}
		return this.saveLoop;
	}

	private async drainSaves(): Promise<void> {
		while (this.saveRequested) {
			this.saveRequested = false;
			this.saving = true;
			try {
				const projectId = this.projectId;
				const project = this.project;
				if (!projectId || !project) return;
				const timeline = sequenceStore.projectTimeline();
				await updateProject(projectId, {
					duration:
						timeline.items.reduce(
							(max, item) => Math.max(max, item.from + item.durationInFrames),
							0
						) / project.metadata.fps,
					timeline,
					metadata: project.metadata,
					animationPresets: project.animationPresets
				});
				this.saveError = '';
				if (!this.saveRequested) timelineStore._clearDirty();
			} catch (error) {
				this.saveError = error instanceof Error ? error.message : String(error);
				logger.error('save failed', error);
				throw error;
			} finally {
				this.saving = false;
			}
		}
	}
}

export const editorSession = new EditorSession();
