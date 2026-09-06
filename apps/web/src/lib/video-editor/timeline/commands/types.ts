/**
 * Snapshot types for the timeline undo/redo system.
 *
 * Commands are metadata only; undo/redo swaps full snapshots. Excludes
 * ephemeral state (isDirty) that shouldn't be in history.
 *
 * Ported from FreeCut (MIT) — commands/types.ts, trimmed to v1.
 */

import type {
	TimelineItem,
	TimelineMarker,
	TimelineTrack,
	TimelineTransition
} from '../../project/types';
import type { AudioEqSettings } from '../../audio/types';
import type { SequenceRegistrySnapshot } from '../../sequences/sequence-store.svelte';

export interface TimelineSnapshot {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	transitions: TimelineTransition[];
	markers: TimelineMarker[];
	inPoint: number | null;
	outPoint: number | null;
	fps: number;
	scrollPosition: number;
	snapEnabled: boolean;
	currentFrame: number;
	masterVolumeDb: number;
	masterMuted: boolean;
	busAudioEq?: AudioEqSettings;
	sequenceRegistry: SequenceRegistrySnapshot;
}

/** Payload values carried alongside a command type for labels/debugging. */
export type CommandPayloadValue = string | number | boolean | null | string[] | number[];

/** Metadata about what action was performed; actual undo uses snapshots. */
export interface TimelineCommand {
	type: string;
	payload?: Record<string, CommandPayloadValue>;
}

export interface CommandEntry {
	command: TimelineCommand;
	beforeSnapshot: TimelineSnapshot;
	afterSnapshot: TimelineSnapshot;
	timestamp: number;
}
