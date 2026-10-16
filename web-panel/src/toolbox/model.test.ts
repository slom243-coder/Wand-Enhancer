import { beforeEach, describe, expect, it } from 'vitest';
import { type CheatSchema, ECheatType } from '../../protocol/messages';
import {
    defaults,
    diffValues,
    emptyGame,
    hotkeyConflicts,
    loadBackup,
    loadData,
    makeBackup,
    normalizeData,
    persistentValues,
    safeLink,
    saveData,
} from './model';

const cheat = (
    target: string,
    type = ECheatType.Toggle,
    hotkeys: string[][] = [],
): CheatSchema => ({
    uuid: target,
    target,
    type,
    name: target,
    category: 'test',
    args: {},
    hotkeys,
});
beforeEach(() => localStorage.clear());
describe('Toolbox data and actions', () => {
    it('persists game notes, compatibility, links, queue, per-game view and cheat labels', () => {
        const data = defaults();
        data.games.alpha = {
            ...emptyGame('Alpha'),
            notes: 'Remember',
            version: '1.2',
            testedAt: '2026-10-16',
            rating: 'Работает',
            priority: 8,
            progress: 45,
            queued: true,
            links: [{ name: 'Guide', url: 'https://example.com/guide' }],
            cheats: {
                god: { alias: 'Защита', note: 'Before combat', confirm: true, rating: 'Работает' },
            },
            view: { query: 'protect', category: 'Player', scroll: 120 },
        };
        data.games.beta = emptyGame('Beta');
        expect(saveData(data)).toBe(true);
        expect(loadData()).toEqual(data);
    });
    it('keeps a separate recoverable backup', () => {
        const before = defaults();
        before.games.alpha = emptyGame('Alpha');
        expect(makeBackup(before)).toBe(true);
        const after = defaults();
        after.games.beta = emptyGame('Beta');
        saveData(after);
        expect(loadData()).toEqual(after);
        expect(loadBackup()).toEqual(before);
    });
    it('rejects unsupported import formats without touching stored data', () => {
        saveData(defaults());
        expect(() => normalizeData({ version: 2 })).toThrow();
        expect(() => normalizeData({ version: 1, appearance: {}, games: [] })).toThrow();
        expect(loadData()).toEqual(defaults());
    });
    it('sanitizes imported values, blocks executable links and prototype keys', () => {
        const raw = JSON.parse(
            '{"version":1,"appearance":{"fontSize":999,"breakMinutes":-5,"accent":"red;}body{display:none"},"games":{"__proto__":{"name":"bad"},"alpha":{"links":[{"name":"bad","url":"javascript:alert(1)"}],"progress":500,"cheats":{"__proto__":{"alias":"bad"}}}}}',
        );
        const data = normalizeData(raw);
        expect(data.appearance.fontSize).toBe(24);
        expect(data.appearance.breakMinutes).toBe(0);
        expect(data.appearance.accent).toBe(defaults().appearance.accent);
        expect(Object.hasOwn(data.games, '__proto__')).toBe(false);
        expect(Object.hasOwn(data.games.alpha.cheats, '__proto__')).toBe(false);
        expect(data.games.alpha.links).toEqual([]);
        expect(data.games.alpha.progress).toBe(100);
    });
    it('only accepts explicit web links without credentials', () => {
        for (const url of [
            'file:///C:/saves',
            'javascript:alert(1)',
            'https://user:secret@example.com',
            'data:text/html,hello',
        ])
            expect(safeLink(url)).toBeNull();
        expect(safeLink('https://example.com/guide')).toBe('https://example.com/guide');
    });
    it('excludes one-shot actions and missing values from rollback and presets', () => {
        const values = persistentValues(
            [
                cheat('god'),
                cheat('money', ECheatType.Number),
                cheat('add', ECheatType.Button),
                cheat('missing'),
            ],
            { god: false, money: 10, add: 1, unknown: 9 },
        );
        expect(values).toEqual({ god: false, money: 10 });
        expect(diffValues(values, { god: false, money: 20 })).toEqual([
            { target: 'money', saved: 10, current: 20 },
        ]);
        expect(diffValues(values, { unrelated: 2 })).toEqual([]);
    });
    it('finds normalized hotkey collisions without flagging a cheat against itself', () => {
        expect(
            hotkeyConflicts([
                cheat('god', ECheatType.Toggle, [
                    ['CTRL', 'F1'],
                    ['F1', 'ctrl'],
                ]),
                cheat('health', ECheatType.Toggle, [['f1', 'Ctrl']]),
            ]),
        ).toEqual([{ key: 'ctrl+f1', names: ['god', 'health'] }]);
    });
});
