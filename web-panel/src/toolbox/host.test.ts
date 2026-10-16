import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    installProductivityTools,
    matchesHotkey,
} from '../../bridge/scripts/default/productivity-tools/host.js';

const instance = () => (globalThis as any).__wandProductivityTools;
beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});
afterEach(() => {
    instance()?.dispose();
    vi.restoreAllMocks();
});
describe('injected Toolbox host', () => {
    it('installs once, opens lazily, and disposes all UI/styles', () => {
        const api = { remoteUrl: 'http://127.0.0.1:3223/remote/' };
        const first = installProductivityTools(api);
        expect(installProductivityTools(api)).toBe(first);
        const root = document.getElementById('wand-productivity-tools')?.shadowRoot;
        expect(root?.querySelector('iframe')).toBeNull();
        first.open();
        expect(root?.querySelector('iframe')?.src).toBe(
            'http://127.0.0.1:3223/remote/toolbox.html',
        );
        first.close();
        expect(root?.querySelector('iframe')).toBeNull();
        first.dispose();
        expect(document.getElementById('wand-productivity-tools')).toBeNull();
        expect(document.getElementById('wand-toolbox-appearance')).toBeNull();
    });
    it('does not accept settings or close requests from other origins/windows', () => {
        const host = installProductivityTools({ remoteUrl: 'http://127.0.0.1:3223/remote/' });
        host.open();
        const frame = document
            .getElementById('wand-productivity-tools')
            ?.shadowRoot?.querySelector('iframe');
        window.dispatchEvent(
            new MessageEvent('message', {
                origin: 'https://other.example',
                source: frame?.contentWindow,
                data: { type: 'wand-toolbox-close' },
            }),
        );
        expect(frame?.isConnected).toBe(true);
        window.dispatchEvent(
            new MessageEvent('message', {
                origin: 'http://127.0.0.1:3223',
                source: window,
                data: { type: 'wand-toolbox-close' },
            }),
        );
        expect(frame?.isConnected).toBe(true);
        window.dispatchEvent(
            new MessageEvent('message', {
                origin: 'http://127.0.0.1:3223',
                source: frame?.contentWindow,
                data: { type: 'wand-toolbox-close' },
            }),
        );
        expect(frame?.isConnected).toBe(false);
    });
    it('applies settings from its frame and rejects invalid selector injection', () => {
        const host = installProductivityTools({ remoteUrl: 'http://127.0.0.1:3223/remote/' });
        host.open();
        const frame = document
            .getElementById('wand-productivity-tools')
            ?.shadowRoot?.querySelector('iframe');
        window.dispatchEvent(
            new MessageEvent('message', {
                origin: 'http://127.0.0.1:3223',
                source: frame?.contentWindow,
                data: {
                    type: 'wand-toolbox-appearance',
                    appearance: {
                        stream: true,
                        privateSelector: 'body{display:none}',
                        fontSize: 18,
                    },
                },
            }),
        );
        const css = document.getElementById('wand-toolbox-appearance')?.textContent;
        expect(css).toContain('18px');
        expect(css).not.toContain('body{display:none}');
    });
    it('does not install periodic DOM observers or timers', () => {
        const interval = vi.spyOn(globalThis, 'setInterval');
        const observer = vi.spyOn(globalThis, 'MutationObserver');
        installProductivityTools({});
        expect(interval).not.toHaveBeenCalled();
        expect(observer).not.toHaveBeenCalled();
    });
    it('matches exact chords, not unmodified keystrokes', () => {
        expect(
            matchesHotkey(
                new KeyboardEvent('keydown', { key: 'E', altKey: true, shiftKey: true }),
                'Alt+Shift+E',
            ),
        ).toBe(true);
        expect(matchesHotkey(new KeyboardEvent('keydown', { key: 'e' }), 'Alt+Shift+E')).toBe(
            false,
        );
    });
});
