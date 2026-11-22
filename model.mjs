import { CROPS, ANIMALS, PRODUCTS, RULES } from './catalog.mjs';

export function initialState() {
  return { schemaVersion: 1, revision: 0, coins: RULES.startCoins,
    inventory: Object.fromEntries(Object.keys(PRODUCTS).map(id => [id, 0])),
    seeds: Object.fromEntries(Object.keys(CROPS).map(id => [id, 0])),
    plots: Array.from({ length: RULES.startPlots }, () => null),
    animals: [{ type: 'chicken', readyAt: null }],
    progress: { harvested: 0, fed: 0, sold: 0 } };
}

const whole = n => Number.isSafeInteger(n) && n >= 0;
const own = (obj, key) => Object.hasOwn(obj, key);
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const timestamp = n => Number.isSafeInteger(n) && n > 0 && n <= 8640000000000000;

// Сохранение считается недоверенным вводом. Неизвестные версии и ID не
// превращаются молча в новую игру: оригинальная строка остаётся в хранилище.
export function validateState(input) {
  if (!record(input)) throw new Error('Сохранение не является объектом.');
  const s = structuredClone(input);
  if (s.schemaVersion === 0) {
    // Прежняя схема прототипа не имела запаса семян и счётчиков обучения.
    s.schemaVersion = 1;
    s.seeds = Object.fromEntries(Object.keys(CROPS).map(id => [id, 0]));
    s.progress = { harvested: 0, fed: 0, sold: 0 };
    s.revision = 0;
  }
  if (s.schemaVersion !== 1) throw new Error('Неизвестная версия сохранения. Нужна совместимая версия игры.');
  if (!whole(s.coins) || !whole(s.revision)) throw new Error('Некорректный баланс или ревизия.');
  for (const [field, catalog] of [['inventory', PRODUCTS], ['seeds', CROPS]]) {
    if (!record(s[field]) || Object.keys(s[field]).some(k => !own(catalog, k))) throw new Error('Неизвестные предметы на складе.');
    for (const key of Object.keys(catalog)) {
      // Новый предмет каталога отсутствует в старом сохранении: его запас равен нулю.
      if (!own(s[field], key)) s[field][key] = 0;
      if (!whole(s[field][key])) throw new Error('Некорректное количество предметов.');
    }
  }
  if (!Array.isArray(s.plots) || s.plots.length < RULES.startPlots || s.plots.length > RULES.maxPlots ||
      s.plots.some(p => p !== null && (!record(p) || !own(CROPS, p.crop) || !timestamp(p.readyAt)))) throw new Error('Некорректные грядки.');
  if (!Array.isArray(s.animals) || s.animals.length < 1 || s.animals.length > 2 ||
      s.animals[0]?.type !== 'chicken' || (s.animals.length === 2 && s.animals[1]?.type !== 'cow') ||
      s.animals.some(a => !record(a) || !own(ANIMALS, a.type) || (a.readyAt !== null && !timestamp(a.readyAt)))) throw new Error('Некорректные животные.');
  if (!record(s.progress) || ['harvested', 'fed', 'sold'].some(k => !whole(s.progress[k]))) throw new Error('Некорректный прогресс.');
  return s;
}

export function canRescue(s) {
  return s.coins < Math.min(...Object.values(CROPS).map(c => c.seed)) &&
    Object.values(s.inventory).every(n => n === 0) && Object.values(s.seeds).every(n => n === 0) &&
    s.plots.every(p => p === null) && s.animals.every(a => a.readyAt === null);
}

// Все операции атомарны: работаем с копией и возвращаем её лишь после полной
// проверки. Таймеры только определяют готовность, начисление делает команда.
export function command(current, action, now = Date.now()) {
  const s = validateState(current);
  if (!timestamp(now)) throw new Error('Некорректное игровое время.');
  const fail = message => { throw new Error(message); };
  const spend = n => { if (s.coins < n) fail('Не хватает монет. Продайте урожай на рынке.'); s.coins -= n; };
  switch (action.type) {
    case 'plant': {
      if (!Number.isInteger(action.plot) || action.plot < 0 || action.plot >= s.plots.length) fail('Грядка не найдена.');
      if (s.plots[action.plot]) fail('Эта грядка уже занята.');
      if (!own(CROPS, action.crop)) fail('Таких семян нет.');
      const c = CROPS[action.crop];
      if (s.seeds[action.crop]) s.seeds[action.crop]--; else spend(c.seed);
      s.plots[action.plot] = { crop: action.crop, readyAt: now + c.seconds * 1000 };
      break;
    }
    case 'harvest': {
      const p = s.plots[action.plot];
      if (!p || now < p.readyAt) fail('Урожай ещё не готов.');
      s.inventory[p.crop] += CROPS[p.crop].yield;
      s.plots[action.plot] = null;
      s.progress.harvested++;
      break;
    }
    case 'feed': {
      const a = s.animals[action.animal];
      if (!a || a.readyAt !== null) fail('Животное уже накормлено.');
      const spec = ANIMALS[a.type];
      if (s.inventory.wheat < spec.feed) fail(`Нужно пшеницы: ${spec.feed}. Вырастите её на грядке.`);
      s.inventory.wheat -= spec.feed;
      a.readyAt = now + spec.seconds * 1000;
      s.progress.fed++;
      break;
    }
    case 'collect': {
      const a = s.animals[action.animal];
      if (!a || a.readyAt === null || now < a.readyAt) fail('Продукция ещё не готова.');
      s.inventory[ANIMALS[a.type].product]++;
      a.readyAt = null;
      break;
    }
    case 'sell': {
      if (!own(PRODUCTS, action.product) || !Number.isSafeInteger(action.count) || action.count <= 0) fail('Некорректная продажа.');
      if (s.inventory[action.product] < action.count) fail('На складе нет такого количества.');
      s.inventory[action.product] -= action.count;
      s.coins += PRODUCTS[action.product].price * action.count;
      s.progress.sold += action.count;
      break;
    }
    case 'buyPlot':
      if (s.plots.length >= RULES.maxPlots) fail('Все двенадцать грядок уже открыты.');
      spend(RULES.plotCost); s.plots.push(null); break;
    case 'buyCow':
      if (s.animals.some(a => a.type === 'cow')) fail('Корова уже живёт на ферме.');
      spend(RULES.cowCost); s.animals.push({ type: 'cow', readyAt: null }); break;
    case 'rescue':
      if (!canRescue(s)) fail('На ферме ещё есть ресурсы для продолжения.');
      s.seeds.wheat++; break;
    default: fail('Неизвестное действие.');
  }
  s.revision++;
  return validateState(s);
}
