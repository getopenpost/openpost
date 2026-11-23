export type ComposerSettingValue =
	| null
	| string
	| number
	| boolean
	| string[]
	| number[]
	| boolean[];

export interface ComposerSettings {
	[key: string]: ComposerSettingValue;
}
