export type ToolboxHost = { open(): void; close(): void; dispose(): void };
export function matchesHotkey(event: KeyboardEvent, chord: string): boolean;
export function installProductivityTools(api?: {
    remoteUrl?: string;
    log?: (...args: unknown[]) => void;
}): ToolboxHost;
