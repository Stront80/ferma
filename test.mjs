import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, command, canRescue, validateState } from './model.mjs';
import { createStorage, SAVE_KEY } from './storage.mjs';
const T = 1800000000000;
const act = (s, a, t = T) => command(s, a, t);
function fakeStore(value = null) {
  let data = value;
  return { getItem: () => data, setItem: (key, next) => { assert.equal(key, SAVE_KEY); data = next; } };
}

test('сквозной цикл: посев, урожай, кормление, яйцо, продажа и грядка', () => {
  let s = act(initialState(), { type: 'plant', plot: 0, crop: 'wheat' });
  assert.equal(s.coins, 58);
  assert.throws(() => act(s, { type: 'harvest', plot: 0 }, T + 19999));
  s = act(s, { type: 'harvest', plot: 0 }, T + 20000);
  assert.equal(s.inventory.wheat, 3);
  assert.throws(() => act(s, { type: 'harvest', plot: 0 }, T + 20000));
  s = act(s, { type: 'feed', animal: 0 });
  assert.equal(s.inventory.wheat, 2);
  assert.throws(() => act(s, { type: 'feed', animal: 0 }));
  assert.throws(() => act(s, { type: 'collect', animal: 0 }, T + 29999));
  s = act(s, { type: 'collect', animal: 0 }, T + 30000);
  assert.equal(s.inventory.egg, 1);
  assert.throws(() => act(s, { type: 'collect', animal: 0 }, T + 30000));
  s = act(s, { type: 'sell', product: 'egg', count: 1 });
  assert.equal(s.coins, 66);
  s = act(s, { type: 'buyPlot' });
  assert.equal(s.coins, 26); assert.equal(s.plots.length, 7);
});

test('от урожая к корове: доход достижим, корм и молоко учитываются один раз', () => {
  let s = initialState();
  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < 6; p++) s = act(s, { type: 'plant', plot: p, crop: 'corn' });
    for (let p = 0; p < 6; p++) s = act(s, { type: 'harvest', plot: p }, T + 60000);
    s = act(s, { type: 'sell', product: 'corn', count: 18 });
  }
  s = act(s, { type: 'buyCow' });
  assert.throws(() => act(s, { type: 'buyCow' }));
  s = act(s, { type: 'plant', plot: 0, crop: 'wheat' });
  s = act(s, { type: 'harvest', plot: 0 }, T + 20000);
  s = act(s, { type: 'feed', animal: 1 });
  assert.equal(s.inventory.wheat, 1);
  s = act(s, { type: 'collect', animal: 1 }, T + 60000);
  assert.equal(s.inventory.milk, 1);
  s = act(s, { type: 'buyPlot' });
  assert.equal(s.plots.length, 7);
});

test('нехватка средств, некорректные команды и переполнение не меняют оригинал', () => {
  const s = initialState();
  const before = structuredClone(s);
  for (const a of [{ type: 'buyCow' }, { type: 'feed', animal: 0 }, { type: 'sell', product: 'egg', count: -1 },
    { type: 'sell', product: 'egg', count: 1 }, { type: 'plant', plot: -1, crop: 'wheat' },
    { type: 'plant', plot: 0, crop: 'constructor' }, { type: 'invalid' }]) assert.throws(() => act(s, a));
  assert.deepEqual(s, before);
  s.coins = Number.MAX_SAFE_INTEGER; s.inventory.egg = 1;
  assert.throws(() => act(s, { type: 'sell', product: 'egg', count: 1 }));
  let rich = initialState(); rich.coins = 1000;
  while (rich.plots.length < 12) rich = act(rich, { type: 'buyPlot' });
  assert.throws(() => act(rich, { type: 'buyPlot' }));
});

test('страховка даёт семя лишь в тупике; из семени можно восстановить экономику', () => {
  let s = initialState(); s.coins = 0;
  assert.equal(canRescue(s), true);
  s = act(s, { type: 'rescue' });
  assert.equal(canRescue(s), false);
  assert.throws(() => act(s, { type: 'rescue' }));
  s = act(s, { type: 'plant', plot: 0, crop: 'wheat' });
  assert.equal(s.coins, 0); assert.equal(canRescue(s), false);
  s = act(s, { type: 'harvest', plot: 0 }, T + 20000);
  s = act(s, { type: 'sell', product: 'wheat', count: 3 });
  assert.equal(s.coins, 6);
  for (const key of ['egg', 'milk', 'wheat', 'carrot', 'corn']) {
    const v = initialState(); v.coins = 0; v.inventory[key] = 1;
    assert.equal(canRescue(v), false);
  }
});

test('валидация отвергает повреждения, будущую схему и преобразует v0', () => {
  for (const value of [-1, NaN, Infinity, 0.5, '60', null]) {
    const s = initialState(); s.coins = value; assert.throws(() => validateState(s));
  }
  const future = initialState(); future.schemaVersion = 2;
  assert.throws(() => validateState(future));
  const unknown = initialState(); unknown.inventory.unknown = 1;
  assert.throws(() => validateState(unknown));
  const old = initialState(); old.schemaVersion = 0; old.coins = 77;
  delete old.seeds; delete old.progress; delete old.revision;
  const migrated = validateState(old);
  assert.equal(migrated.schemaVersion, 1); assert.equal(migrated.coins, 77);
  assert.equal(migrated.seeds.wheat, 0); assert.equal(old.schemaVersion, 0);
  const newItem = initialState(); delete newItem.inventory.corn; delete newItem.seeds.corn;
  assert.equal(validateState(newItem).inventory.corn, 0);
  const badTime = initialState(); badTime.plots[0] = { crop: 'wheat', readyAt: Infinity };
  assert.throws(() => validateState(badTime));
});

test('хранилище: перезагрузка, повреждение без перезаписи, запрет/квота, конфликт вкладок', () => {
  const fake = fakeStore();
  const a = createStorage(() => fake);
  const b = createStorage(() => fake);
  a.load(); b.load();
  assert.equal(a.save(initialState()).status, 'saved');
  assert.equal(b.save(initialState()).status, 'conflict');
  const reloaded = createStorage(() => fake);
  assert.equal(reloaded.load().state.coins, 60);
  const corrupt = fakeStore('{broken');
  const c = createStorage(() => corrupt);
  assert.equal(c.load().status, 'blocked');
  assert.equal(c.save(initialState()).status, 'blocked');
  assert.equal(corrupt.getItem(), '{broken');
  assert.equal(c.startNew().status, 'saved');
  const denied = createStorage(() => { throw new Error('запрещено'); });
  assert.equal(denied.load().status, 'memory');
  assert.equal(denied.save(initialState()).status, 'memory');
  const quota = createStorage(() => ({ getItem: () => null, setItem: () => { throw new Error('квота'); } }));
  quota.load(); assert.equal(quota.save(initialState()).status, 'memory');
});

test('10000 случайных команд сохраняют инварианты и отсутствие экономического тупика', () => {
  let seed = 227;
  const random = n => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  let s = initialState();
  for (let i = 0; i < 10000; i++) {
    const now = T + i * 30000;
    const choices = [
      { type: 'plant', plot: random(s.plots.length), crop: ['wheat', 'carrot', 'corn'][random(3)] },
      { type: 'harvest', plot: random(s.plots.length) }, { type: 'feed', animal: random(s.animals.length) },
      { type: 'collect', animal: random(s.animals.length) }, { type: 'sell', product: ['wheat', 'carrot', 'corn', 'egg', 'milk'][random(5)], count: 1 },
      { type: 'buyPlot' }, { type: 'buyCow' }, { type: 'rescue' },
    ];
    try { s = command(s, choices[random(choices.length)], now); } catch { /* Ожидаемые отказы недоступных команд. */ }
    assert.doesNotThrow(() => validateState(s));
    if (canRescue(s)) assert.equal(command(s, { type: 'rescue' }, now).seeds.wheat, 1);
  }
});
