import { render } from 'preact';
import {
    cloneElement,
    isValidElement,
    type ReactElement,
    type ReactNode,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';
import { WEB_CONTRACT } from '../../protocol/contract';
import {
    ECheatType,
    type GameStatusPayload,
    type InstalledAppSummary,
    type TrainerMetaPayload,
} from '../../protocol/messages';
import { RemoteSessionClient } from '../remote-session/remote-session.client';
import { getTrainerStorageId, loadString, saveString } from '../shared/storage';
import {
    capturePresetValues,
    createPreset,
    getPresetStorageKey,
    loadPresets,
    type RemotePreset,
    savePresets,
} from '../trainer/presets/preset-storage';
import {
    type Appearance,
    type CheatNote,
    defaults,
    diffValues,
    emptyGame,
    type GameNote,
    type HistoryEntry,
    hotkeyConflicts,
    loadBackup,
    loadData,
    MAX_HISTORY,
    makeBackup,
    normalizeData,
    persistentValues,
    safeLink,
    saveData,
    type ToolboxData,
} from './model';
import './toolbox.css';

type Health = {
    ok?: boolean;
    readOnly?: boolean;
    connectedClients?: number;
    advertisedUrls?: string[];
};
function useRemote() {
    const [meta, setMeta] = useState<TrainerMetaPayload | null>(null);
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [apps, setApps] = useState<InstalledAppSummary[]>([]);
    const [gameStatus, setGameStatus] = useState<GameStatusPayload | null>(null);
    const [status, setStatus] = useState('Подключение');
    const [error, setError] = useState('');
    const [health, setHealth] = useState<Health>({});
    const [lastHealth, setLastHealth] = useState(0);
    const [lastEvent, setLastEvent] = useState('');
    const [notice, setNotice] = useState('');
    const client = useRef<RemoteSessionClient | null>(null);
    const initial = useRef<Record<string, unknown>>({});
    const trainerId = useRef('');
    const metaRef = useRef<TrainerMetaPayload | null>(null);
    const capture = useRef(false);
    useEffect(() => {
        let disposed = false;
        let retry: ReturnType<typeof setTimeout> | undefined;
        let controller: AbortController | undefined;
        const url = new URL(WEB_CONTRACT.webSocketPath, location.origin);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const reconnect = () => {
            if (disposed || document.hidden) return;
            clearTimeout(retry);
            retry = setTimeout(connect, 2500);
        };
        const connect = () => {
            if (disposed || document.hidden) return;
            client.current?.disconnect();
            capture.current = true;
            client.current = new RemoteSessionClient(url.href, {
                onConnecting: () => setStatus('Подключение'),
                onTransportOpen: () => setStatus('Согласование'),
                onClose: () => {
                    setStatus('Связь потеряна');
                    reconnect();
                },
                onError: (message) => {
                    setError(message);
                    setStatus('Ошибка связи');
                    reconnect();
                },
                onMessage: (message) => {
                    setLastEvent(message.type);
                    if (message.type === 'hello_ack') {
                        setStatus('Подключено');
                        setError('');
                    }
                    if (message.type === 'trainer_changed') {
                        trainerId.current = message.payload.trainerId;
                        initial.current = {};
                        capture.current = true;
                        metaRef.current = null;
                        setMeta(null);
                        setValues({});
                    }
                    if (message.type === 'trainer_meta') {
                        if (trainerId.current !== message.payload.trainer.trainerId) {
                            initial.current = {};
                            capture.current = true;
                        }
                        trainerId.current = message.payload.trainer.trainerId;
                        metaRef.current = message.payload;
                        setMeta(message.payload);
                    }
                    if (
                        message.type === 'trainer_values' &&
                        message.payload.trainerId === trainerId.current
                    ) {
                        setValues(message.payload.values);
                        if (capture.current && metaRef.current) {
                            initial.current = persistentValues(
                                metaRef.current.schema.cheats,
                                message.payload.values,
                            );
                            capture.current = false;
                        }
                    }
                    if (
                        message.type === 'value_changed' &&
                        message.payload.trainerId === trainerId.current
                    ) {
                        const p = message.payload;
                        setValues((old) => ({ ...old, [p.target]: p.value }));
                        setHistory((old) =>
                            [
                                ...old,
                                {
                                    time: new Date().toISOString(),
                                    trainerId: p.trainerId,
                                    target: p.target,
                                    previous: p.oldValue,
                                    value: p.value,
                                    source: p.source ?? '',
                                },
                            ].slice(-MAX_HISTORY),
                        );
                    }
                    if (message.type === 'installed_apps') setApps(message.payload.apps);
                    if (message.type === 'game_status') {
                        setGameStatus(message.payload);
                        setNotice(
                            `Игра: ${message.payload.session.state}; трейнер: ${message.payload.trainer.state}`,
                        );
                    }
                    if (message.type === 'error') setError(message.payload.message);
                    if (
                        (message.type === 'set_value_result' ||
                            message.type === 'remote_command_result') &&
                        !message.payload.ok
                    )
                        setError(message.payload.error?.message ?? 'Команда отклонена');
                },
            });
            client.current.connect();
        };
        const healthCheck = async () => {
            if (disposed || document.hidden) return;
            controller?.abort();
            controller = new AbortController();
            const timeout = setTimeout(() => controller?.abort(), 5000);
            try {
                const response = await fetch(WEB_CONTRACT.healthPath, {
                    signal: controller.signal,
                    cache: 'no-store',
                });
                if (!response.ok) throw new Error(String(response.status));
                const data = await response.json();
                if (!disposed) {
                    setHealth(data);
                    setLastHealth(Date.now());
                }
            } catch {
                if (!disposed) {
                    setHealth({ ok: false });
                    setError('Проверка bridge не удалась');
                }
            } finally {
                clearTimeout(timeout);
            }
        };
        const visibility = () => {
            clearTimeout(retry);
            if (document.hidden) {
                client.current?.disconnect();
                controller?.abort();
                setStatus('Пауза в фоне');
            } else {
                connect();
                void healthCheck();
            }
        };
        connect();
        void healthCheck();
        const interval = setInterval(() => void healthCheck(), 15000);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            disposed = true;
            clearTimeout(retry);
            clearInterval(interval);
            controller?.abort();
            client.current?.disconnect();
            document.removeEventListener('visibilitychange', visibility);
        };
    }, []);
    return {
        meta,
        values,
        history,
        apps,
        gameStatus,
        status,
        error,
        health,
        lastHealth,
        lastEvent,
        notice,
        client,
        initial,
        clearHistory: () => setHistory([]),
    };
}
function Field({ label, children }: { label: string; children: ReactNode }) {
    const id = useId();
    const control = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null;
    const controlId = control?.props.id || id;
    return (
        <div className="field">
            <label htmlFor={controlId}>{label}</label>
            {control ? cloneElement(control, { id: controlId }) : children}
        </div>
    );
}

function download(name: string, value: unknown) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ToolboxApp() {
    const remote = useRemote();
    const [data, setData] = useState<ToolboxData>(loadData);
    const lastSaved = useRef(data);
    const [tab, setTab] = useState(() => {
        const tab = loadString('wand-enhancer.toolbox.tab');
        return ['games', 'cheats', 'history', 'appearance', 'diagnostics'].includes(tab ?? '')
            ? tab!
            : 'games';
    });
    const [selectedGame, setSelectedGame] = useState('');
    const [message, setMessage] = useState('');
    const [now, setNow] = useState(Date.now());
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [presets, setPresets] = useState<RemotePreset[]>([]);
    const [presetId, setPresetId] = useState('');
    const scroll = useRef<HTMLDivElement>(null);
    const remindedAt = useRef('');
    const a = data.appearance;
    const activeGame = getTrainerStorageId(remote.meta?.trainer);
    const gameId = selectedGame || activeGame || '';
    const game = Object.hasOwn(data.games, gameId)
        ? data.games[gameId]
        : emptyGame(remote.meta?.trainer.displayName ?? '');
    const cheats = remote.meta?.schema.cheats ?? [];
    const isActive = !!activeGame && gameId === activeGame;
    const readOnly = a.readOnly || remote.health.readOnly === true;
    const ready =
        remote.status === 'Подключено' &&
        remote.health.ok === true &&
        now - remote.lastHealth < 35000;
    const storageKey = getPresetStorageKey(remote.meta?.trainer ?? null);
    const started = remote.gameStatus?.session.startedAt;
    const elapsed = started
        ? Math.max(0, Math.floor((now - new Date(started).getTime()) / 60000))
        : 0;
    const conflicts = hotkeyConflicts(cheats);
    const updateAppearance = <K extends keyof Appearance>(key: K, value: Appearance[K]) =>
        setData((old) => ({ ...old, appearance: { ...old.appearance, [key]: value } }));
    const updateGame = (patch: Partial<GameNote>) => {
        if (!gameId) return;
        setData((old) => ({
            ...old,
            games: {
                ...old.games,
                [gameId]: {
                    ...(Object.hasOwn(old.games, gameId)
                        ? old.games[gameId]
                        : emptyGame(remote.meta?.trainer.displayName ?? '')),
                    ...patch,
                },
            },
        }));
    };
    const updateCheat = (target: string, patch: Partial<CheatNote>) =>
        updateGame({
            cheats: {
                ...game.cheats,
                [target]: {
                    alias: '',
                    note: '',
                    confirm: false,
                    rating: '',
                    ...(Object.hasOwn(game.cheats, target) ? game.cheats[target] : {}),
                    ...patch,
                },
            },
        });
    useEffect(() => {
        saveString('wand-enhancer.toolbox.tab', tab);
    }, [tab]);
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (lastSaved.current !== data) makeBackup(lastSaved.current);
            lastSaved.current = data;
            if (!saveData(data))
                setMessage('Не удалось сохранить данные: хранилище недоступно или заполнено.');
        }, 500);
        return () => clearTimeout(timeout);
    }, [data]);
    useEffect(() => {
        const flush = () => {
            if (!saveData(data)) setMessage('Не удалось сохранить последние изменения.');
        };
        const visibility = () => {
            if (document.hidden) flush();
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, [data]);
    useEffect(() => {
        if (tab !== 'cheats' || !gameId || !scroll.current) return;
        const node = scroll.current;
        node.scrollTop = loadData().games[gameId]?.view.scroll ?? 0;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const savePosition = () => {
            clearTimeout(timeout);
            timeout = setTimeout(
                () =>
                    setData((old) => {
                        if (!Object.hasOwn(old.games, gameId)) return old;
                        const entry = old.games[gameId];
                        return {
                            ...old,
                            games: {
                                ...old.games,
                                [gameId]: {
                                    ...entry,
                                    view: { ...entry.view, scroll: node.scrollTop },
                                },
                            },
                        };
                    }),
                250,
            );
        };
        node.addEventListener('scroll', savePosition, { passive: true });
        return () => {
            clearTimeout(timeout);
            node.removeEventListener('scroll', savePosition);
        };
    }, [gameId, tab]);
    useEffect(() => {
        document.documentElement.style.setProperty('--accent', a.accent);
        document.documentElement.style.fontSize = `${a.fontSize}px`;
        document.body.classList.toggle('compact', a.compact);
        document.body.classList.toggle('contrast', a.highContrast);
        document.body.classList.toggle('still', a.reduceMotion);
        document.body.classList.toggle('large-controls', a.gamepad);
        if (window.parent !== window)
            window.parent.postMessage({ type: 'wand-toolbox-appearance', appearance: a }, '*');
    }, [a]);
    useEffect(() => {
        const timer = setInterval(() => {
            if (!document.hidden) setNow(Date.now());
        }, 5000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        if (!a.notifications || !remote.notice) return;
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
            new Notification('Wand', { body: remote.notice });
    }, [remote.notice, a.notifications]);
    useEffect(() => {
        if (
            !a.breakMinutes ||
            !started ||
            remote.gameStatus?.session.state !== 'running' ||
            elapsed < a.breakMinutes ||
            remindedAt.current === started
        )
            return;
        remindedAt.current = started;
        setMessage(`Вы играете ${elapsed} мин. Пора сделать перерыв.`);
        if (
            a.notifications &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted'
        )
            new Notification('Перерыв', { body: `Сеанс длится ${elapsed} мин.` });
    }, [elapsed, started, a.breakMinutes, a.notifications, remote.gameStatus?.session.state]);
    useEffect(() => {
        setPresets(loadPresets(storageKey));
        setPresetId('');
    }, [storageKey]);
    useEffect(() => {
        const view = loadData().games[gameId]?.view;
        setQuery(view?.query ?? '');
        setCategory(view?.category ?? '');
        if (scroll.current) scroll.current.scrollTop = view?.scroll ?? 0;
    }, [gameId]);
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && window.parent !== window)
                window.parent.postMessage({ type: 'wand-toolbox-close' }, '*');
            if (event.ctrlKey && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setTab('cheats');
                setTimeout(() => document.getElementById('cheat-search')?.focus(), 0);
            }
        };
        document.addEventListener('keydown', keydown);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let previousButtons: boolean[] = [];
        const navigate = () => {
            clearTimeout(timer);
            if (!a.gamepad || document.hidden) return;
            const pad = navigator.getGamepads?.()[0];
            if (pad) {
                const pressed = pad.buttons.map((button) => button.pressed);
                const edge = (index: number) => pressed[index] && !previousButtons[index];
                const elements = [
                    ...document.querySelectorAll<HTMLElement>(
                        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href]',
                    ),
                ].filter((el) => !el.hidden && el.getClientRects().length > 0);
                const index = elements.indexOf(document.activeElement as HTMLElement);
                if (edge(13) || edge(15)) elements[(index + 1) % elements.length]?.focus();
                else if (edge(12) || edge(14))
                    elements[(index - 1 + elements.length) % elements.length]?.focus();
                if (edge(0) && document.activeElement instanceof HTMLButtonElement)
                    document.activeElement.click();
                previousButtons = pressed;
            } else previousButtons = [];
            timer = setTimeout(navigate, 100);
        };
        const visibility = () => {
            previousButtons = [];
            navigate();
        };
        navigate();
        document.addEventListener('visibilitychange', visibility);
        return () => {
            document.removeEventListener('keydown', keydown);
            document.removeEventListener('visibilitychange', visibility);
            clearTimeout(timer);
        };
    }, [a.gamepad]);
    function write(target: string, value: unknown) {
        if (readOnly || !ready || !remote.meta) {
            setMessage('Управление недоступно: проверьте соединение и режим просмотра.');
            return;
        }
        if (
            game.cheats[target]?.confirm &&
            !confirm(`Изменить «${game.cheats[target]?.alias || target}»?`)
        )
            return;
        if (
            !remote.client.current?.setValue(
                remote.meta.trainer.trainerId,
                target,
                value,
                cheats.find((c) => c.target === target)?.uuid,
            )
        )
            setMessage('Команда не отправлена.');
    }
    function importFile(file: File | undefined) {
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            setMessage('Максимальный размер файла: 2 МБ.');
            return;
        }
        void file
            .text()
            .then((value) => {
                const next = normalizeData(JSON.parse(value));
                if (
                    !confirm(
                        'Заменить заметки и настройки данными из файла? Текущая версия останется в резервной копии.',
                    )
                )
                    return;
                if (!makeBackup(data))
                    throw new Error('Не удалось сохранить резервную копию или импорт.');
                setData(next);
                setMessage('Импорт завершён.');
            })
            .catch((error) => setMessage(String(error)));
    }
    const names = new Map<string, string>();
    for (const [id, note] of Object.entries(data.games)) names.set(id, note.name || id);
    for (const app of remote.apps) {
        const id = app.gameId || app.titleId;
        if (id) names.set(id, app.displayName);
    }
    if (activeGame) names.set(activeGame, remote.meta?.trainer.displayName || activeGame);
    return (
        <div className="toolbox">
            <header>
                <div>
                    <h1>Wand Toolbox</h1>
                    <p>
                        {remote.status} · {readOnly ? 'Просмотр' : 'Управление'} ·{' '}
                        {remote.gameStatus?.session.state === 'running'
                            ? `${elapsed} мин в игре`
                            : 'Игра не запущена'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() =>
                        window.parent !== window
                            ? window.parent.postMessage({ type: 'wand-toolbox-close' }, '*')
                            : window.close()
                    }
                >
                    Закрыть
                </button>
            </header>
            <nav aria-label="Разделы">
                {[
                    ['games', 'Игры и заметки'],
                    ['cheats', 'Настройки трейнера'],
                    ['history', 'История'],
                    ['appearance', 'Интерфейс'],
                    ['diagnostics', 'Диагностика'],
                ].map(([id, title]) => (
                    <button
                        key={id}
                        type="button"
                        aria-pressed={tab === id}
                        onClick={() => setTab(id)}
                    >
                        {title}
                    </button>
                ))}
            </nav>
            {message && (
                <p role="status" className="banner">
                    {message}{' '}
                    <button type="button" onClick={() => setMessage('')}>
                        ×
                    </button>
                </p>
            )}
            {remote.error && <p role="alert">{remote.error}</p>}
            <main ref={scroll}>
                {(tab === 'games' || tab === 'cheats') && (
                    <Field label="Игра">
                        <select
                            value={selectedGame}
                            onChange={(event) => setSelectedGame(event.currentTarget.value)}
                        >
                            <option value="">Текущая игра</option>
                            {[...names].map(([id, name]) => (
                                <option key={id} value={id}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}
                {tab === 'games' && (
                    <>
                        <button
                            type="button"
                            onClick={() => {
                                const name = prompt('Название игры');
                                if (name?.trim()) {
                                    const id = `manual-${Date.now()}`;
                                    setData((old) => ({
                                        ...old,
                                        games: { ...old.games, [id]: emptyGame(name.trim()) },
                                    }));
                                    setSelectedGame(id);
                                }
                            }}
                        >
                            Добавить игру вручную
                        </button>
                        {gameId && (
                            <section>
                                <Field label="Название">
                                    <input
                                        value={game.name || names.get(gameId) || ''}
                                        onInput={(e) => updateGame({ name: e.currentTarget.value })}
                                    />
                                </Field>
                                <Field label="Заметки и справка">
                                    <textarea
                                        rows={6}
                                        value={game.notes}
                                        onInput={(e) =>
                                            updateGame({ notes: e.currentTarget.value })
                                        }
                                    />
                                </Field>
                                <div className="grid">
                                    <Field label="Проверенная версия игры">
                                        <input
                                            value={game.version}
                                            onInput={(e) =>
                                                updateGame({ version: e.currentTarget.value })
                                            }
                                        />
                                    </Field>
                                    <Field label="Дата проверки">
                                        <input
                                            type="date"
                                            value={game.testedAt}
                                            onInput={(e) =>
                                                updateGame({ testedAt: e.currentTarget.value })
                                            }
                                        />
                                    </Field>
                                    <Field label="Совместимость">
                                        <select
                                            value={game.rating}
                                            onChange={(e) =>
                                                updateGame({ rating: e.currentTarget.value })
                                            }
                                        >
                                            <option value="">Не проверено</option>
                                            <option>Работает</option>
                                            <option>Частично</option>
                                            <option>Не работает</option>
                                        </select>
                                    </Field>
                                </div>
                                <Field label="В очереди на прохождение">
                                    <input
                                        type="checkbox"
                                        checked={game.queued}
                                        onChange={(e) =>
                                            updateGame({ queued: e.currentTarget.checked })
                                        }
                                    />
                                </Field>
                                <div className="grid">
                                    <Field label="Приоритет 0–10">
                                        <input
                                            type="number"
                                            min={0}
                                            max={10}
                                            value={game.priority}
                                            onInput={(e) =>
                                                updateGame({
                                                    priority: Number(e.currentTarget.value),
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field label="Прогресс, %">
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={game.progress}
                                            onInput={(e) =>
                                                updateGame({
                                                    progress: Number(e.currentTarget.value),
                                                })
                                            }
                                        />
                                    </Field>
                                </div>
                                <h2>Ссылки</h2>
                                {game.links.map((link, index) => (
                                    <p key={`${index}-${link.url}`}>
                                        <a
                                            href={link.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {link.name || link.url}
                                        </a>{' '}
                                        <button
                                            type="button"
                                            onClick={() =>
                                                updateGame({
                                                    links: game.links.filter((_, i) => i !== index),
                                                })
                                            }
                                        >
                                            Удалить
                                        </button>
                                    </p>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const url = prompt('Адрес гайда или страницы (http/https)');
                                        if (!url) return;
                                        const valid = safeLink(url);
                                        if (!valid) {
                                            setMessage(
                                                'Нужна ссылка http/https без логина и пароля.',
                                            );
                                            return;
                                        }
                                        const name = prompt('Подпись ссылки') || valid;
                                        updateGame({
                                            links: [...game.links, { name, url: valid }].slice(
                                                0,
                                                20,
                                            ),
                                        });
                                    }}
                                >
                                    Добавить ссылку
                                </button>
                            </section>
                        )}
                        <section>
                            <h2>Очередь игр</h2>
                            {Object.entries(data.games)
                                .filter(([, g]) => g.queued)
                                .sort(([, x], [, y]) => y.priority - x.priority)
                                .map(([id, note]) => (
                                    <p key={id}>
                                        <button type="button" onClick={() => setSelectedGame(id)}>
                                            {note.name || id}
                                        </button>{' '}
                                        · {note.progress}% · приоритет {note.priority}
                                    </p>
                                ))}
                        </section>
                        <section>
                            <h2>Перенос и резервные копии</h2>
                            <p>
                                Хранятся на этом устройстве в браузере. Данные разных устройств
                                автоматически не синхронизируются.
                            </p>
                            <button
                                type="button"
                                onClick={() => download('wand-toolbox-settings.json', data)}
                            >
                                Экспорт JSON
                            </button>
                            <Field label="Импорт JSON">
                                <input
                                    type="file"
                                    accept=".json,application/json"
                                    onChange={(e) => {
                                        importFile(e.currentTarget.files?.[0]);
                                        e.currentTarget.value = '';
                                    }}
                                />
                            </Field>
                            <button
                                type="button"
                                onClick={() =>
                                    setMessage(
                                        makeBackup(data)
                                            ? 'Резервная копия сохранена.'
                                            : 'Не удалось сохранить.',
                                    )
                                }
                            >
                                Создать копию
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const backup = loadBackup();
                                    if (backup && confirm('Восстановить предыдущие настройки?')) {
                                        setData(backup);
                                        setMessage('Копия восстановлена.');
                                    } else if (!backup) setMessage('Копии пока нет.');
                                }}
                            >
                                Восстановить копию
                            </button>
                        </section>
                    </>
                )}
                {tab === 'cheats' && (
                    <>
                        <p>
                            Переименования и подсказки действуют в Toolbox. Ctrl+K — поиск. Возврат
                            значений не отменяет уже произошедшие изменения в игре.
                        </p>
                        {!isActive ? (
                            <p>Откройте трейнер выбранной игры, чтобы увидеть его настройки.</p>
                        ) : (
                            <>
                                <div className="grid">
                                    <Field label="Поиск по названию, описанию и заметкам">
                                        <input
                                            id="cheat-search"
                                            value={query}
                                            onInput={(e) => {
                                                const value = e.currentTarget.value;
                                                setQuery(value);
                                                updateGame({
                                                    view: {
                                                        query: value,
                                                        category,
                                                        scroll: scroll.current?.scrollTop ?? 0,
                                                    },
                                                });
                                            }}
                                        />
                                    </Field>
                                    <Field label="Категория">
                                        <select
                                            value={category}
                                            onChange={(e) => {
                                                const value = e.currentTarget.value;
                                                setCategory(value);
                                                updateGame({
                                                    view: {
                                                        query,
                                                        category: value,
                                                        scroll: scroll.current?.scrollTop ?? 0,
                                                    },
                                                });
                                            }}
                                        >
                                            <option value="">Все</option>
                                            {[...new Set(cheats.map((c) => c.category))].map(
                                                (c) => (
                                                    <option key={c}>{c}</option>
                                                ),
                                            )}
                                        </select>
                                    </Field>
                                </div>
                                {cheats
                                    .filter(
                                        (c) =>
                                            (!category || c.category === category) &&
                                            [
                                                c.name,
                                                c.description,
                                                c.instructions,
                                                game.cheats[c.target]?.alias,
                                                game.cheats[c.target]?.note,
                                            ]
                                                .join(' ')
                                                .toLowerCase()
                                                .includes(query.toLowerCase()),
                                    )
                                    .map((c) => {
                                        const note = game.cheats[c.target];
                                        return (
                                            <section key={c.uuid}>
                                                <h2>{note?.alias || c.name}</h2>
                                                <p>{c.description || c.instructions}</p>
                                                <p>
                                                    Значение:{' '}
                                                    {String(remote.values[c.target] ?? '—')} ·{' '}
                                                    {c.hotkeys
                                                        ?.map((k) => k.join('+'))
                                                        .join(' / ') || 'Хоткей не задан'}
                                                </p>
                                                <Field label="Своё название">
                                                    <input
                                                        value={note?.alias ?? ''}
                                                        onInput={(e) =>
                                                            updateCheat(c.target, {
                                                                alias: e.currentTarget.value,
                                                            })
                                                        }
                                                    />
                                                </Field>
                                                <Field label="Подсказка / когда включать">
                                                    <textarea
                                                        value={note?.note ?? ''}
                                                        onInput={(e) =>
                                                            updateCheat(c.target, {
                                                                note: e.currentTarget.value,
                                                            })
                                                        }
                                                    />
                                                </Field>
                                                <Field label="Личная оценка">
                                                    <select
                                                        value={note?.rating ?? ''}
                                                        onChange={(e) =>
                                                            updateCheat(c.target, {
                                                                rating: e.currentTarget.value,
                                                            })
                                                        }
                                                    >
                                                        <option value="">Не проверено</option>
                                                        <option>Работает</option>
                                                        <option>Частично</option>
                                                        <option>Не работает</option>
                                                    </select>
                                                </Field>
                                                <Field label="Подтверждать изменение в Toolbox">
                                                    <input
                                                        type="checkbox"
                                                        checked={note?.confirm ?? false}
                                                        onChange={(e) =>
                                                            updateCheat(c.target, {
                                                                confirm: e.currentTarget.checked,
                                                            })
                                                        }
                                                    />
                                                </Field>
                                                {c.type === ECheatType.Toggle ? (
                                                    <button
                                                        type="button"
                                                        disabled={readOnly || !ready}
                                                        onClick={() =>
                                                            write(
                                                                c.target,
                                                                !remote.values[c.target],
                                                            )
                                                        }
                                                    >
                                                        {remote.values[c.target]
                                                            ? 'Выключить'
                                                            : 'Включить'}
                                                    </button>
                                                ) : c.type === ECheatType.Button ? (
                                                    <p>
                                                        Одноразовое действие: используйте штатную
                                                        панель Wand.
                                                    </p>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={readOnly || !ready}
                                                        onClick={() => {
                                                            const raw = prompt(
                                                                'Новое значение',
                                                                String(
                                                                    remote.values[c.target] ?? '',
                                                                ),
                                                            );
                                                            if (raw === null) return;
                                                            const old = remote.values[c.target];
                                                            const value =
                                                                typeof old === 'number'
                                                                    ? Number(raw)
                                                                    : raw;
                                                            if (
                                                                typeof value === 'number' &&
                                                                (!Number.isFinite(value) ||
                                                                    (c.args.min !== undefined &&
                                                                        value < c.args.min) ||
                                                                    (c.args.max !== undefined &&
                                                                        value > c.args.max))
                                                            ) {
                                                                setMessage(
                                                                    'Значение вне допустимого диапазона.',
                                                                );
                                                                return;
                                                            }
                                                            write(c.target, value);
                                                        }}
                                                    >
                                                        Изменить значение
                                                    </button>
                                                )}
                                            </section>
                                        );
                                    })}
                                <section>
                                    <h2>Наборы настроек и сравнение</h2>
                                    <p>
                                        Используется то же хранилище пресетов, что у основной
                                        веб-панели.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const name = prompt('Название набора');
                                            if (!name?.trim() || !remote.meta) return;
                                            const next = [
                                                ...loadPresets(storageKey),
                                                createPreset(
                                                    name,
                                                    capturePresetValues(cheats, remote.values),
                                                ),
                                            ];
                                            if (savePresets(storageKey, next)) setPresets(next);
                                            else setMessage('Не удалось сохранить набор.');
                                        }}
                                    >
                                        Сохранить текущие значения
                                    </button>
                                    <select
                                        aria-label="Набор для сравнения"
                                        value={presetId}
                                        onChange={(e) => setPresetId(e.currentTarget.value)}
                                    >
                                        <option value="">Выберите набор</option>
                                        {presets.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.name}
                                            </option>
                                        ))}
                                    </select>
                                    {diffValues(
                                        presets.find((p) => p.id === presetId)?.values ?? {},
                                        remote.values,
                                    ).map((d) => (
                                        <p key={d.target}>
                                            {d.target}: сейчас {String(d.current)}, в наборе{' '}
                                            {String(d.saved)}
                                        </p>
                                    ))}
                                    <button
                                        type="button"
                                        disabled={!presetId || readOnly || !ready}
                                        onClick={() => {
                                            const preset = presets.find((p) => p.id === presetId);
                                            if (
                                                preset &&
                                                confirm('Применить отличающиеся значения набора?')
                                            )
                                                for (const entry of diffValues(
                                                    persistentValues(cheats, preset.values),
                                                    remote.values,
                                                ))
                                                    write(entry.target, entry.saved);
                                        }}
                                    >
                                        Применить набор
                                    </button>
                                </section>
                                <section>
                                    <h2>Конфликты хоткеев</h2>
                                    {conflicts.length ? (
                                        conflicts.map((c) => (
                                            <p key={c.key}>
                                                {c.key}: {c.names.join(', ')}
                                            </p>
                                        ))
                                    ) : (
                                        <p>
                                            Конфликтов в доступной схеме нет. Системные и игровые
                                            хоткеи здесь не проверяются.
                                        </p>
                                    )}
                                </section>
                                <button
                                    type="button"
                                    disabled={readOnly || !ready}
                                    onClick={() => {
                                        if (
                                            (!a.confirmStop || confirm('Остановить трейнер?')) &&
                                            !remote.client.current?.stopPlaying(
                                                remote.meta?.trainer.gameId,
                                            )
                                        )
                                            setMessage('Команда не отправлена.');
                                    }}
                                >
                                    Остановить трейнер
                                </button>
                            </>
                        )}
                    </>
                )}
                {tab === 'history' && (
                    <>
                        <p>
                            Записываются последние {MAX_HISTORY} событий, пока Toolbox открыт. После
                            скрытия/закрытия соединение приостанавливается. Исходные значения
                            фиксируются заново при переподключении или смене трейнера.
                        </p>
                        <button
                            type="button"
                            onClick={() => download('wand-toolbox-history.json', remote.history)}
                        >
                            Экспорт истории
                        </button>
                        <button type="button" onClick={remote.clearHistory}>
                            Очистить историю
                        </button>
                        <button
                            type="button"
                            disabled={!remote.meta || !ready || readOnly}
                            onClick={() => {
                                if (
                                    confirm(
                                        'Вернуть наблюдаемые исходные значения текущего трейнера? Это не откат сохранения игры.',
                                    )
                                )
                                    for (const entry of diffValues(
                                        persistentValues(cheats, remote.initial.current),
                                        remote.values,
                                    ))
                                        write(entry.target, entry.saved);
                            }}
                        >
                            Вернуть исходные значения
                        </button>
                        {[...remote.history].reverse().map((entry, i) => (
                            <p key={`${entry.time}-${i}`}>
                                {new Date(entry.time).toLocaleTimeString()} · {entry.trainerId} ·{' '}
                                {entry.target}: {String(entry.previous)} → {String(entry.value)} ·{' '}
                                {entry.source}
                            </p>
                        ))}
                    </>
                )}
                {tab === 'appearance' && (
                    <>
                        <p>
                            Внешний вид desktop Wand меняется через внедрённый скрипт. Вкладка
                            браузера управляет только своим интерфейсом. При несовпадении селекторов
                            с версией Wand настройте их ниже.
                        </p>
                        {(
                            [
                                ['compact', 'Компактный интерфейс'],
                                ['highContrast', 'Повышенная контрастность'],
                                ['reduceMotion', 'Отключить анимации'],
                                ['hideSidebar', 'Скрывать боковую панель Wand'],
                                ['hidePromos', 'Скрывать рекламные карточки'],
                                ['stream', 'Режим трансляции: скрывать личные блоки'],
                                ['screenshot', 'Режим скриншота: скрывать панели'],
                                ['gamepad', 'Крупные элементы и геймпад (D-pad / A)'],
                                ['readOnly', 'Просмотр: заблокировать команды в Toolbox'],
                                ['confirmStop', 'Подтверждать остановку из Toolbox'],
                            ] as const
                        ).map(([key, label]) => (
                            <Field key={key} label={label}>
                                <input
                                    type="checkbox"
                                    checked={a[key]}
                                    onChange={(e) => updateAppearance(key, e.currentTarget.checked)}
                                />
                            </Field>
                        ))}
                        <Field label="Размер текста, 12–24 px">
                            <input
                                type="number"
                                min={12}
                                max={24}
                                value={a.fontSize}
                                onInput={(e) =>
                                    updateAppearance(
                                        'fontSize',
                                        Math.max(
                                            12,
                                            Math.min(24, Number(e.currentTarget.value) || 14),
                                        ),
                                    )
                                }
                            />
                        </Field>
                        <Field label="Акцентный цвет">
                            <input
                                type="color"
                                value={a.accent}
                                onInput={(e) => updateAppearance('accent', e.currentTarget.value)}
                            />
                        </Field>
                        <Field label="Напомнить о перерыве через, мин (0 — выключено)">
                            <input
                                type="number"
                                min={0}
                                max={240}
                                value={a.breakMinutes}
                                onInput={(e) =>
                                    updateAppearance(
                                        'breakMinutes',
                                        Math.max(
                                            0,
                                            Math.min(240, Number(e.currentTarget.value) || 0),
                                        ),
                                    )
                                }
                            />
                        </Field>
                        <Field label="Уведомления о состоянии игры и трейнера">
                            <input
                                type="checkbox"
                                checked={a.notifications}
                                onChange={(e) => {
                                    const enabled = e.currentTarget.checked;
                                    updateAppearance('notifications', enabled);
                                    if (enabled && typeof Notification !== 'undefined')
                                        void Notification.requestPermission().then((p) => {
                                            if (p !== 'granted')
                                                setMessage('Уведомления не разрешены браузером.');
                                        });
                                }}
                            />
                        </Field>
                        <Field label="Хоткей открыть/закрыть Toolbox в Wand">
                            <input
                                value={a.hotkey}
                                onInput={(e) =>
                                    updateAppearance('hotkey', e.currentTarget.value.slice(0, 80))
                                }
                            />
                        </Field>
                        <p>
                            Alt+Shift+S — режим скриншота; Ctrl+K — поиск в Toolbox; Alt+Shift+F —
                            поиск Wand. Хоткеи работают, когда окно в фокусе.
                        </p>
                        <Field label="CSS-селектор поиска Wand">
                            <input
                                value={a.searchSelector}
                                onInput={(e) =>
                                    updateAppearance(
                                        'searchSelector',
                                        e.currentTarget.value.slice(0, 500),
                                    )
                                }
                            />
                        </Field>
                        <Field label="CSS-селекторы личных блоков">
                            <input
                                value={a.privateSelector}
                                onInput={(e) =>
                                    updateAppearance(
                                        'privateSelector',
                                        e.currentTarget.value.slice(0, 500),
                                    )
                                }
                            />
                        </Field>
                        <Field label="CSS-селектор кнопки остановки Wand (пусто — не перехватывать)">
                            <input
                                value={a.stopSelector}
                                onInput={(e) =>
                                    updateAppearance(
                                        'stopSelector',
                                        e.currentTarget.value.slice(0, 500),
                                    )
                                }
                            />
                        </Field>
                        <p>
                            Для запрета управления на стороне bridge запустите Windows-патчер через
                            Start-ReadOnly.cmd и затем Wand из этого процесса. Этот режим блокирует
                            все удалённые команды, включая другие телефоны.
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                if (confirm('Сбросить оформление? Заметки сохранятся.'))
                                    setData((old) => ({
                                        ...old,
                                        appearance: defaults().appearance,
                                    }));
                            }}
                        >
                            Сбросить оформление
                        </button>
                    </>
                )}
                {tab === 'diagnostics' && (
                    <>
                        <h2>Связь и готовность</h2>
                        <p role="status">
                            {ready
                                ? 'Bridge отвечает'
                                : 'Данные могут быть устаревшими; управление заблокировано'}
                        </p>
                        <p>
                            Подключений: {remote.health.connectedClients ?? 'нет данных'} · событие:{' '}
                            {remote.lastEvent || 'пока нет'} · проверка:{' '}
                            {remote.lastHealth
                                ? new Date(remote.lastHealth).toLocaleTimeString()
                                : 'ещё не выполнена'}
                        </p>
                        <p>
                            Режим bridge:{' '}
                            {remote.health.readOnly ? 'Только просмотр' : 'Управление разрешено'}
                        </p>
                        <h2>Подключение телефона</h2>
                        {(remote.health.advertisedUrls ?? []).map((url) => (
                            <p key={url}>{url}</p>
                        ))}
                        <p>
                            QR-код локальной панели уже добавляет встроенный remote-popup-cleanup.js
                            в окно Wand.
                        </p>
                        <h2>После обновления Wand</h2>
                        <ul>
                            <li>Сама панель Toolbox загрузилась.</li>
                            <li>Протокол bridge: {remote.status}.</li>
                            <li>
                                Доступная схема трейнера:{' '}
                                {remote.meta
                                    ? `${cheats.length} функций`
                                    : 'нет — откройте трейнер'}
                                .
                            </li>
                            <li>
                                Список игр: {remote.apps.length}; отсутствие списка при старте не
                                доказывает ошибку скрипта.
                            </li>
                        </ul>
                        <p>
                            Измерения памяти, автоматическое кэширование загрузок и открытие папок
                            сохранений требуют доступа к самому Wand. В этот набор они не входят.
                        </p>
                        <button
                            type="button"
                            onClick={() =>
                                download('wand-toolbox-diagnostics.json', {
                                    time: new Date().toISOString(),
                                    status: remote.status,
                                    connectedClients: remote.health.connectedClients,
                                    lastEvent: remote.lastEvent,
                                    schemaCount: cheats.length,
                                    appCount: remote.apps.length,
                                    readOnly: remote.health.readOnly,
                                })
                            }
                        >
                            Сохранить диагностику без данных аккаунта
                        </button>
                    </>
                )}
            </main>
        </div>
    );
}
const root = document.getElementById('toolbox');
if (root) render(<ToolboxApp />, root);
