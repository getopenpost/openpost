import type { TransitionDirection, Project } from '../project/types';
import type { MediaMetadata } from '../media/types';
import type { TimerSettings } from '../timers/timer';
import type { TextStylePresetId, AnimationPreset } from '../project/types';
import type { EffectTemplate } from '../timeline/effect-drop';

export type LibraryRecipe =
	| {
			kind: 'selection';
			project: Project;
			media: Array<{ metadata: MediaMetadata; blob: Blob }>;
	  }
	| {
			kind: 'transition';
			presentation: string;
			direction?: TransitionDirection;
	  }
	| {
			kind: 'text-style';
			selection: Extract<LibraryRecipe, { kind: 'selection' }>;
	  }
	| { kind: 'timer'; timer: TimerSettings }
	| { kind: 'text'; presetId: TextStylePresetId }
	| { kind: 'effects'; effects: EffectTemplate[] }
	| { kind: 'animation'; preset: AnimationPreset };

export interface LibraryTextSlot {
	name: string;
	target_id: string;
	max_characters: number;
}

export interface LibraryEntry {
	slots?: LibraryTextSlot[];
	id: string;
	scope: string;
	name: string;
	collection: string;
	favorite: boolean;
	favoriteOwnerID?: string;
	position: number;
	lastUsed?: number;
	recipe: LibraryRecipe;
}
