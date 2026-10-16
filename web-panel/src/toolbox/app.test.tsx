import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ECheatType } from '../../protocol/messages';
import { ToolboxApp } from './main';
import { loadData } from './model';

const state = vi.hoisted(() => ({
    handlers: null as any,
    setValue: vi.fn(() => 'req'),
    disconnect: vi.fn(),
}));
vi.mock('../remote-session/remote-session.client', () => ({
    RemoteSessionClient: class {
        constructor(_url: string, handlers: unknown) {
            state.handlers = handlers;
        }
        connect() {
            state.handlers.onTransportOpen();
            state.handlers.onMessage({ type: 'hello_ack', payload: {} });
        }
        disconnect = state.disconnect;
        setValue = state.setValue;
        stopPlaying = vi.fn(() => true);
    },
}));
const send = (type: string, payload: unknown) =>
    act(() => state.handlers.onMessage({ type, payload }));
function trainer(id: string) {
    send('trainer_changed', { trainerId: id });
    send('trainer_meta', {
        session: { instanceId: 'test' },
        trainer: { trainerId: id, gameId: id, displayName: id },
        schema: {
            categories: ['Player'],
            cheats: [
                {
                    uuid: 'god',
                    target: 'god',
                    name: 'Protection',
                    category: 'Player',
                    type: ECheatType.Toggle,
                    args: {},
                },
                {
                    uuid: 'once',
                    target: 'once',
                    name: 'Once',
                    category: 'Player',
                    type: ECheatType.Button,
                    args: {},
                },
            ],
        },
    });
    send('trainer_values', { trainerId: id, values: { god: false, once: 0 } });
}
beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    state.setValue.mockClear();
    state.disconnect.mockClear();
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, connectedClients: 1 }) })),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
async function mount() {
    render(<ToolboxApp />);
    await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
    });
}
describe('Toolbox user workflows', () => {
    it('saves notes and queue per game without changing the other game', async () => {
        await mount();
        trainer('alpha');
        fireEvent.input(screen.getByLabelText('Заметки и справка'), {
            target: { value: 'Before boss' },
        });
        fireEvent.click(screen.getByLabelText('В очереди на прохождение'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
        });
        expect(loadData().games.alpha.notes).toBe('Before boss');
        expect(loadData().games.alpha.queued).toBe(true);
        trainer('beta');
        expect((screen.getByLabelText('Заметки и справка') as HTMLTextAreaElement).value).toBe('');
        expect(loadData().games.alpha.notes).toBe('Before boss');
    });
    it('rolls back only persistent values observed for the current trainer', async () => {
        await mount();
        trainer('alpha');
        send('value_changed', { trainerId: 'alpha', target: 'god', value: true, oldValue: false });
        send('value_changed', { trainerId: 'alpha', target: 'once', value: 1, oldValue: 0 });
        fireEvent.click(screen.getByText('История'));
        fireEvent.click(screen.getByText('Вернуть исходные значения'));
        expect(state.setValue).toHaveBeenCalledExactlyOnceWith('alpha', 'god', false, 'god');
        state.setValue.mockClear();
        trainer('beta');
        fireEvent.click(screen.getByText('Вернуть исходные значения'));
        expect(state.setValue).not.toHaveBeenCalled();
    });
    it('asks before a marked action and keeps read-only controls disabled', async () => {
        await mount();
        trainer('alpha');
        fireEvent.click(screen.getByText('Настройки трейнера'));
        fireEvent.click(screen.getAllByLabelText('Подтверждать изменение в Toolbox')[0]);
        vi.mocked(window.confirm).mockReturnValueOnce(false);
        fireEvent.click(screen.getByText('Включить'));
        expect(state.setValue).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Интерфейс'));
        fireEvent.click(screen.getByLabelText('Просмотр: заблокировать команды в Toolbox'));
        fireEvent.click(screen.getByText('Настройки трейнера'));
        expect((screen.getByText('Включить') as HTMLButtonElement).disabled).toBe(true);
    });
    it('disconnects when hidden and disposes timers on unmount', async () => {
        await mount();
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        fireEvent(document, new Event('visibilitychange'));
        expect(state.disconnect).toHaveBeenCalled();
        cleanup();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(vi.getTimerCount()).toBe(0);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    });
});
