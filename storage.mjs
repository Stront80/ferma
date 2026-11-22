import { initialState, validateState } from './model.mjs';
export const SAVE_KEY = 'farm.save.v1';

export function createStorage(getStorage) {
  let expected = null;
  let memoryOnly = false;
  let blocked = false;
  const api = {
    load() {
      try {
        expected = getStorage().getItem(SAVE_KEY);
      } catch {
        memoryOnly = true;
        return { state: initialState(), status: 'memory', message: 'Хранилище недоступно. Игра идёт в памяти и пропадёт после закрытия.' };
      }
      if (expected === null) return { state: initialState(), status: 'new' };
      try {
        const state = validateState(JSON.parse(expected));
        blocked = false;
        return { state, status: 'saved' };
      } catch (e) {
        blocked = true;
        return { state: null, status: 'blocked', message: e.message + ' Существующее сохранение оставлено без изменений.' };
      }
    },
    save(state) {
      if (blocked) return { status: 'blocked' };
      if (memoryOnly) return { status: 'memory' };
      try {
        const store = getStorage();
        // Сравниваем исходную строку, а не только номер: это обнаруживает и
        // удаление сохранения другой вкладкой. Одновременная игра не поддержана.
        if (store.getItem(SAVE_KEY) !== expected) return { status: 'conflict' };
        const next = JSON.stringify(validateState(state));
        store.setItem(SAVE_KEY, next);
        expected = next;
        return { status: 'saved' };
      } catch {
        memoryOnly = true;
        return { status: 'memory' };
      }
    },
    isChanged() {
      if (memoryOnly) return false;
      try { return getStorage().getItem(SAVE_KEY) !== expected; } catch { return false; }
    },
    startNew() {
      // Вызывается только после явного подтверждения в окне восстановления.
      // При конкурентном изменении старой строки сброс не выполняется.
      try {
        if (getStorage().getItem(SAVE_KEY) !== expected) return { status: 'conflict' };
        blocked = false;
        return api.save(initialState());
      } catch { return { status: 'blocked' }; }
    },
  };
  return api;
}
