import { loadJson, saveJson } from '../../../../src/shared/storage';
import { defaults, normalizeData } from '../../../../src/toolbox/model';

const HOST_KEY = 'wand-enhancer.toolbox-host.v1';
const FLAG = '__wandProductivityTools';

export function matchesHotkey(event, chord) {
    const parts = String(chord)
        .toLowerCase()
        .split('+')
        .map((v) => v.trim());
    const key = parts.pop();
    return (
        !!key &&
        event.key.toLowerCase() === key &&
        event.altKey === parts.includes('alt') &&
        event.shiftKey === parts.includes('shift') &&
        event.ctrlKey === parts.includes('ctrl') &&
        event.metaKey === parts.includes('meta')
    );
}
export function installProductivityTools(api) {
    if (globalThis[FLAG]) return globalThis[FLAG];
    let appearance = loadJson(
        HOST_KEY,
        (raw) => {
            try {
                return normalizeData({ version: 1, games: {}, appearance: raw }).appearance;
            } catch {
                return null;
            }
        },
        defaults().appearance,
    );
    const host = document.createElement('div');
    host.id = 'wand-productivity-tools';
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = document.createElement('style');
    sheet.textContent =
        ':host{all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;font:14px system-ui;color:#fff}button{font:inherit;color:#fff;background:#33364d;border:1px solid #aaa;border-radius:10px;padding:10px;cursor:pointer}button:focus-visible{outline:3px solid #a99aff}iframe{position:fixed;right:16px;bottom:70px;width:min(1000px,calc(100vw - 32px));height:min(820px,calc(100vh - 100px));border:1px solid #888;border-radius:12px;background:#14151c}';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Toolbox';
    toggle.setAttribute('aria-label', 'Открыть Wand Toolbox');
    toggle.setAttribute('aria-expanded', 'false');
    shadow.append(sheet, toggle);
    const style = document.createElement('style');
    style.id = 'wand-toolbox-appearance';
    let frame = null;
    let returnFocus = null;
    const selectors = {
        sidebar: '.sidebar, .sidebar-container',
        promos: 'article.pro-onboarding-card, article.pro-onboarding-card--remote',
    };
    function applyAppearance() {
        // Validate selectors with the DOM parser before inserting them in a stylesheet.
        const valid = (selector) => {
            if (!selector || /[{}@]/.test(selector)) return '';
            try {
                document.querySelector(selector);
                return selector;
            } catch {
                return '';
            }
        };
        const privateSelector = valid(appearance.privateSelector);
        style.textContent = `
            html { font-size: ${appearance.fontSize}px !important; --wand-toolbox-accent: ${appearance.accent}; }
            ${appearance.compact ? '.sidebar-game-row-container { min-height:32px !important; padding-top:2px !important; padding-bottom:2px !important }' : ''}
            ${appearance.highContrast ? 'body { filter:contrast(1.25) }' : ''}
            ${appearance.reduceMotion ? '*,*::before,*::after { animation:none !important;transition:none !important;scroll-behavior:auto !important }' : ''}
            ${appearance.hideSidebar || appearance.screenshot ? `${selectors.sidebar} { display:none !important }` : ''}
            ${appearance.hidePromos ? `${selectors.promos} { display:none !important }` : ''}
            ${appearance.stream && privateSelector ? `${privateSelector} { visibility:hidden !important }` : ''}
            ${appearance.screenshot ? 'header, .top-bar, .toolbar { visibility:hidden !important }' : ''}
            ${appearance.gamepad ? 'button, input, select { min-height:44px }' : ''}
            button:focus-visible,a:focus-visible,input:focus-visible { outline-color:var(--wand-toolbox-accent) !important }
        `;
    }
    function close() {
        frame?.remove();
        frame = null;
        toggle.setAttribute('aria-expanded', 'false');
        if (returnFocus?.isConnected) returnFocus.focus();
        else toggle.focus();
    }
    function open() {
        if (frame) {
            close();
            return;
        }
        try {
            const raw = globalThis.__wandRemoteBridgeUrl || api?.remoteUrl;
            const base = new URL(raw);
            if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Unsupported URL');
            returnFocus = document.activeElement;
            frame = document.createElement('iframe');
            frame.title = 'Wand Toolbox';
            frame.src = new URL('toolbox.html', base).href;
            frame.setAttribute(
                'sandbox',
                'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups',
            );
            shadow.append(frame);
            toggle.setAttribute('aria-expanded', 'true');
            frame.focus();
        } catch (error) {
            api?.log?.('Toolbox: адрес bridge недоступен', String(error));
        }
    }
    const click = (event) => {
        if (!appearance.confirmStop || !appearance.stopSelector) return;
        try {
            const hit = event
                .composedPath()
                .find((el) => el instanceof Element && el.matches(appearance.stopSelector));
            if (hit && !confirm('Остановить трейнер?')) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        } catch {
            /* Invalid selectors are shown in the settings field; do not disrupt Wand. */
        }
    };
    const keydown = (event) => {
        if (event.repeat || event.isComposing) return;
        if (matchesHotkey(event, appearance.hotkey)) {
            event.preventDefault();
            open();
        } else if (matchesHotkey(event, 'Alt+Shift+S')) {
            event.preventDefault();
            appearance.screenshot = !appearance.screenshot;
            applyAppearance();
            saveJson(HOST_KEY, appearance, () => false);
        } else if (matchesHotkey(event, 'Alt+Shift+F')) {
            try {
                const search = document.querySelector(appearance.searchSelector);
                if (search) {
                    event.preventDefault();
                    search.focus();
                }
            } catch {
                /* Unsupported Wand layout. */
            }
        } else if (event.key === 'Escape' && frame) close();
    };
    const message = (event) => {
        if (
            !frame ||
            event.source !== frame.contentWindow ||
            event.origin !== new URL(frame.src).origin
        )
            return;
        if (event.data?.type === 'wand-toolbox-close') close();
        if (event.data?.type === 'wand-toolbox-appearance') {
            try {
                appearance = normalizeData({
                    version: 1,
                    games: {},
                    appearance: event.data.appearance,
                }).appearance;
            } catch {
                return;
            }
            applyAppearance();
            saveJson(HOST_KEY, appearance, () => false);
        }
    };
    const mount = () => {
        document.body.append(host);
        document.head.append(style);
        applyAppearance();
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
    toggle.addEventListener('click', open);
    document.addEventListener('keydown', keydown);
    document.addEventListener('click', click, true);
    window.addEventListener('message', message);
    const instance = {
        open,
        close,
        dispose() {
            close();
            host.remove();
            style.remove();
            document.removeEventListener('DOMContentLoaded', mount);
            document.removeEventListener('keydown', keydown);
            document.removeEventListener('click', click, true);
            window.removeEventListener('message', message);
            delete globalThis[FLAG];
        },
    };
    globalThis[FLAG] = instance;
    api?.log?.('Wand Toolbox установлен; кнопка справа внизу, Alt+Shift+E.');
    return instance;
}
