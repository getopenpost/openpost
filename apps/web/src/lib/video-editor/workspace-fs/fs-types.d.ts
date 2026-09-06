/**
 * File System Access API surface used by the video editor that TypeScript's
 * standard lib.dom does not declare (yet). Kept minimal and local.
 */

interface FileSystemShowDirectoryPickerOptions {
	id?: string;
	mode?: 'read' | 'readwrite';
	startIn?: string | FileSystemHandle;
}

interface FileSystemShowOpenFilePickerOptions {
	multiple?: boolean;
	types?: {
		description?: string;
		accept: Record<string, string[]>;
	}[];
	excludeAcceptAllOption?: boolean;
	startIn?: string | FileSystemHandle;
}

interface Window {
	showDirectoryPicker?: (
		options?: FileSystemShowDirectoryPickerOptions
	) => Promise<FileSystemDirectoryHandle>;
	showOpenFilePicker?: (
		options?: FileSystemShowOpenFilePickerOptions
	) => Promise<FileSystemFileHandle[]>;
}

interface FileSystemFileHandle {
	move?: (parent: FileSystemDirectoryHandle, newName: string) => Promise<void>;
	queryPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
	requestPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
	values: () => AsyncIterableIterator<FileSystemHandle>;
	queryPermission: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
	requestPermission: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}
