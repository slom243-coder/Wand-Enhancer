import { type CheatSchema, ECheatType } from '../../protocol/messages';
import { loadJson, saveJson } from '../shared/storage';

export const TOOLBOX_KEY = 'wand-enhancer.toolbox.v1';
export const MAX_HISTORY = 250;
export type Appearance = {
    compact: boolean;
    fontSize: number;
    accent: string;
    highContrast: boolean;
    reduceMotion: boolean;
    stream: boolean;
    screenshot: boolean;
    hideSidebar: boolean;
    hidePromos: boolean;
    gamepad: boolean;
    notifications: boolean;
    readOnly: boolean;
    breakMinutes: number;
    hotkey: string;
    searchSelector: string;
    privateSelector: string;
    stopSelector: string;
    confirmStop: boolean;
};
export type CheatNote = { alias: string; note: string; confirm: boolean; rating: string };
export type GameNote = {
    name: string;
    notes: string;
    version: string;
    testedAt: string;
    rating: string;
    priority: number;
    progress: number;
    queued: boolean;
    links: { name: string; url: string }[];
    cheats: Record<string, CheatNote>;
    view: { query: string; category: string; scroll: number };
};
export type ToolboxData = {
    version: 1;
    appearance: Appearance;
    games: Record<string, GameNote>;
};
export type HistoryEntry = {
    time: string;
    trainerId: string;
    target: string;
    previous: unknown;
    value: unknown;
    source: string;
};
export function defaults(): ToolboxData {
    return {
        version: 1,
        appearance: {
            compact: false,
            fontSize: 14,
            accent: '#8b7bff',
            highContrast: false,
            reduceMotion: false,
            stream: false,
            screenshot: false,
            hideSidebar: false,
            hidePromos: false,
            gamepad: false,
            notifications: false,
            readOnly: false,
            breakMinutes: 60,
            hotkey: 'Alt+Shift+E',
            searchSelector: 'input[type="search"]',
            privateSelector:
                '[data-private], .account-avatar, .account-name, .user-avatar, .user-name',
            stopSelector: '',
            confirmStop: true,
        },
        games: {},
    };
}
export function emptyGame(name = ''): GameNote {
    return {
        name,
        notes: '',
        version: '',
        testedAt: '',
        rating: '',
        priority: 0,
        progress: 0,
        queued: false,
        links: [],
        cheats: {},
        view: { query: '', category: '', scroll: 0 },
    };
}
const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 12000) => (typeof v === 'string' ? v.slice(0, max) : '');
const number = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
export function safeLink(value: string): string | null {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
            ? url.href
            : null;
    } catch {
        return null;
    }
}
export function normalizeData(raw: unknown): ToolboxData {
    if (!record(raw) || raw.version !== 1 || !record(raw.games) || !record(raw.appearance)) {
        throw new Error('Неверный формат файла. Нужен экспорт Wand Toolbox v1.');
    }
    const result = defaults();
    for (const key of Object.keys(result.appearance) as (keyof Appearance)[]) {
        const value = raw.appearance[key];
        const initial = result.appearance[key];
        if (typeof initial === 'boolean' && typeof value === 'boolean')
            Object.assign(result.appearance, { [key]: value });
        if (typeof initial === 'string' && typeof value === 'string')
            Object.assign(result.appearance, { [key]: text(value, 500) });
    }
    result.appearance.fontSize = number(raw.appearance.fontSize, 14, 12, 24);
    result.appearance.breakMinutes = number(raw.appearance.breakMinutes, 60, 0, 240);
    if (!/^#[0-9a-f]{6}$/i.test(result.appearance.accent)) result.appearance.accent = '#8b7bff';
    for (const [id, value] of Object.entries(raw.games).slice(0, 1000)) {
        if (!record(value) || ['__proto__', 'constructor', 'prototype'].includes(id)) continue;
        const game = emptyGame(text(value.name, 200));
        for (const key of ['notes', 'version', 'testedAt', 'rating'] as const)
            game[key] = text(value[key]);
        game.priority = number(value.priority, 0, 0, 10);
        game.progress = number(value.progress, 0, 0, 100);
        game.queued = value.queued === true;
        if (Array.isArray(value.links))
            game.links = value.links.slice(0, 20).flatMap((link) => {
                if (!record(link)) return [];
                const url = safeLink(text(link.url, 2000));
                return url ? [{ name: text(link.name, 100), url }] : [];
            });
        if (record(value.cheats))
            for (const [target, note] of Object.entries(value.cheats).slice(0, 500)) {
                if (!record(note) || ['__proto__', 'constructor', 'prototype'].includes(target))
                    continue;
                Object.defineProperty(game.cheats, target, {
                    value: {
                        alias: text(note.alias, 200),
                        note: text(note.note),
                        confirm: note.confirm === true,
                        rating: text(note.rating, 100),
                    },
                    enumerable: true,
                    writable: true,
                });
            }
        if (record(value.view))
            game.view = {
                query: text(value.view.query, 200),
                category: text(value.view.category, 200),
                scroll: number(value.view.scroll, 0, 0, 100000),
            };
        Object.defineProperty(result.games, id, { value: game, enumerable: true, writable: true });
    }
    return result;
}
export function loadData(): ToolboxData {
    return loadJson(
        TOOLBOX_KEY,
        (raw) => {
            try {
                return normalizeData(raw);
            } catch {
                return null;
            }
        },
        defaults(),
    );
}
export function saveData(data: ToolboxData): boolean {
    return saveJson(TOOLBOX_KEY, data, () => false);
}
export function makeBackup(data: ToolboxData): boolean {
    return saveJson(`${TOOLBOX_KEY}.backup`, data, () => false);
}
export function loadBackup(): ToolboxData | null {
    return loadJson<ToolboxData | null>(
        `${TOOLBOX_KEY}.backup`,
        (raw) => {
            try {
                return normalizeData(raw);
            } catch {
                return null;
            }
        },
        null,
    );
}
export function persistentValues(
    cheats: CheatSchema[],
    values: Record<string, unknown>,
): Record<string, unknown> {
    return Object.fromEntries(
        cheats
            .filter((c) => c.type !== ECheatType.Button && Object.hasOwn(values, c.target))
            .map((c) => [c.target, values[c.target]]),
    );
}
export function diffValues(saved: Record<string, unknown>, current: Record<string, unknown>) {
    return Object.entries(saved)
        .filter(([key, value]) => Object.hasOwn(current, key) && !Object.is(value, current[key]))
        .map(([target, value]) => ({ target, saved: value, current: current[target] }));
}
export function hotkeyConflicts(cheats: CheatSchema[]) {
    const keys = new Map<string, Set<string>>();
    for (const cheat of cheats)
        for (const chord of cheat.hotkeys ?? []) {
            const key = [...new Set(chord.map((k) => k.trim().toLowerCase()))].sort().join('+');
            if (!key) continue;
            if (!keys.has(key)) keys.set(key, new Set());
            keys.get(key)?.add(cheat.name);
        }
    return [...keys]
        .filter(([, names]) => names.size > 1)
        .map(([key, names]) => ({ key, names: [...names] }));
}
