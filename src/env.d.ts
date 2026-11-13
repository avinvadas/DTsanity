/** True in the strict (offline, no usability recording) build. Set in vite.config.ts. */
declare const __STRICT__: boolean;
/** The build stamp: commit and build time. Set in vite.config.ts. */
declare const __VERSION__: string;

// File System Access API (Chromium). Not in TypeScript's DOM lib yet; used
// only after feature detection, so files can be re-read for "Reload".
interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
}
interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?(options?: { mode?: 'read' }): Promise<FileSystemDirectoryHandle>;
}
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>;
}
