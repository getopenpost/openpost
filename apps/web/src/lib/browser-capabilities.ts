export interface OpenPostFilePickerType {
	description: string;
	accept: { [mimeType: string]: string[] };
}

export interface OpenPostSaveFilePickerOptions {
	suggestedName: string;
	types: OpenPostFilePickerType[];
}

export interface OpenPostEyeDropperResult {
	sRGBHex: string;
}

export interface OpenPostEyeDropper {
	open(): Promise<OpenPostEyeDropperResult>;
}

export type OpenPostEyeDropperConstructor = new () => OpenPostEyeDropper;
export type OpenPostFileSystemDirectoryHandle = FileSystemDirectoryHandle;

declare global {
	interface Window {
		showSaveFilePicker?(options: OpenPostSaveFilePickerOptions): Promise<FileSystemFileHandle>;
		EyeDropper?: OpenPostEyeDropperConstructor;
	}

	interface FileSystemDirectoryHandle {
		entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
	}
}
