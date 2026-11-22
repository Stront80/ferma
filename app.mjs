import { CROPS, ANIMALS, PRODUCTS, RULES } from './catalog.mjs';
import { command, canRescue } from './model.mjs';
import { createStorage, SAVE_KEY } from './storage.mjs';
import { scenery, plantArt } from './art.mjs';

const $ = id => document.getElementById(id);
const storage = createStorage(() => window.localStorage);
let loaded = storage.load();
let state = loaded.state;
let tab = 'plots';
let chosenPlot = null;
let frozen = loaded.status === 'blocked';
let toastTimeout;
let returnFocus = null;

function notice(text) {
  $('toast').textContent = text;
  $('toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 4200);
}

function warning(text) {
  $('storage-warning').hidden = !text;
  $('storage-warning').textContent = text || '';
}

function showDialog(id) {
  returnFocus = document.activeElement;
  $(id).showModal();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    // После перерисовки кнопка могла быть заменена: находим её по стабильному ID.
    const target = returnFocus?.id ? $(returnFocus.id) : returnFocus;
    if (target?.isConnected) target.focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-close]')) dialog.close();
  });
}
$('conflict-dialog').addEventListener('cancel', e => e.preventDefault());
$('help').addEventListener('click', () => showDialog('help-dialog'));

function conflict() {
  frozen = true;
  $('game-content').classList.add('conflict-lock');
  $('seed-dialog').close();
  $('help-dialog').close();
  if (!$('conflict-dialog').open) showDialog('conflict-dialog');
}

function syncStatus(status) {
  if (status === 'memory') {
    warning('Сохранение недоступно. Вы можете играть, но прогресс пропадёт после закрытия страницы.');
    $('save-status').textContent = 'Игра в памяти · сохранение недоступно';
  } else if (status === 'saved') {
    $('save-status').textContent = '✓ Сохранено в этом браузере';
  }
}

function perform(action, text) {
  if (frozen || !state) return;
  if (storage.isChanged()) { conflict(); return; }
  try {
    const next = command(state, action);
    const result = storage.save(next);
    if (result.status === 'conflict') { conflict(); return; }
    if (result.status === 'blocked') return;
    state = next;
    syncStatus(result.status);
    const focusID = document.activeElement?.id;
    render();
    if (focusID) $(focusID)?.focus();
    notice(text);
  } catch (error) { notice(error.message); }
}

function timeLeft(readyAt) {
  const seconds = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Готово!';
}

function cropOptions() {
  $('seed-options').innerHTML = Object.entries(CROPS).map(([id, c]) => {
    const free = state.seeds[id] > 0;
    return `<div class="seed-option"><span class="seed-icon" aria-hidden="true">${c.icon}</span><div><h3>${c.name}</h3><p>${c.seconds} с · урожай ${c.yield} шт.<br>${free ? `Семян в запасе: ${state.seeds[id]}` : `Семена: ${c.seed} мон. · продажа: ${c.price}/шт.`}</p></div><button class="primary" data-plant="${id}" ${!free && state.coins < c.seed ? 'disabled title="Не хватает монет"' : ''} aria-label="Посадить: ${c.name}, ${free ? 'из запаса' : c.seed + ' монеты'}">${free ? 'Из запаса' : '✦ ' + c.seed} · сажать</button></div>`;
  }).join('');
}

function renderPlots() {
  $('game-content').innerHTML = `<div class="farm-field"><div class="field-scenery"><span class="scenery-label">ТИХО РАСТЁТ ВАША ИСТОРИЯ</span>${scenery}</div><div class="plot-grid">${state.plots.map((p, index) => {
    const c = p && CROPS[p.crop];
    const ready = p && Date.now() >= p.readyAt;
    return `<button id="plot-${index}" class="plot ${p ? (ready ? 'ready' : 'growing') : 'empty'}" data-plot="${index}" aria-label="Грядка ${index + 1}: ${p ? c.name + (ready ? ', собрать урожай' : ', растёт') : 'посадить семена'}">${p ? plantArt(p.crop, ready) : '<span class="empty-symbol" aria-hidden="true">＋</span>'}<span class="plot-title">${p ? c.name : 'Посадить'}</span><span class="plot-status" ${p ? `data-ready-at="${p.readyAt}"` : ''}>${p ? ready ? 'Собрать урожай' : 'Растёт · ' + timeLeft(p.readyAt) : 'Здесь начнётся жизнь'}</span>${p ? `<span class="plot-progress" aria-hidden="true"><i data-progress="${p.readyAt}" data-duration="${c.seconds * 1000}"></i></span>` : ''}</button>`;
  }).join('')}</div><div class="field-bottom"><p>🌱 ${state.plots.length} из ${RULES.maxPlots} грядок открыто</p><button id="buy-plot" ${state.coins < RULES.plotCost || state.plots.length === RULES.maxPlots ? 'disabled' : ''}>${state.plots.length === RULES.maxPlots ? 'Все грядки открыты' : `＋ Грядка · ${RULES.plotCost} мон.`}</button></div></div><p class="season-note"><span>✿</span> Урожай не испортится. Возвращайтесь, когда захотите.</p>${canRescue(state) ? '<div class="rescue-card"><h3>Начнём заново с одного семечка</h3><p>Ресурсы закончились? Возьмите бесплатные семена пшеницы и продолжайте выращивать.</p><button class="primary" id="rescue">Получить семена бесплатно</button></div>' : ''}`;
  }

function renderAnimals() {
  $('game-content').innerHTML = `<div class="animal-grid">${state.animals.map((a, i) => {
    const spec = ANIMALS[a.type];
    const ready = a.readyAt !== null && Date.now() >= a.readyAt;
    return `<article class="animal-card"><div class="animal-art" aria-hidden="true">${spec.icon}</div><h3>${spec.name}</h3><p>${spec.feed} пшеницы → ${PRODUCTS[spec.product].icon} ${PRODUCTS[spec.product].name.toLowerCase()}<br>За ${spec.seconds} секунд · ${PRODUCTS[spec.product].price} мон.</p><span class="timer-label" ${a.readyAt !== null ? `data-ready-at="${a.readyAt}"` : ''}>${a.readyAt === null ? (state.inventory.wheat < spec.feed ? `Нужно пшеницы: ${spec.feed}; в амбаре: ${state.inventory.wheat}` : 'Ждёт вашего угощения') : ready ? 'Можно забирать!' : 'Отдыхает · ' + timeLeft(a.readyAt)}</span><button id="animal-${i}" class="primary" data-animal="${i}" ${a.readyAt === null ? state.inventory.wheat < spec.feed ? 'disabled' : '' : !ready ? 'disabled' : ''}>${a.readyAt === null ? 'Покормить' : ready ? 'Забрать продукцию' : 'Готовится…'}</button></article>`;
  }).join('')}${!state.animals.some(a => a.type === 'cow') ? `<article class="animal-card"><div class="animal-art" aria-hidden="true">🐄</div><h3>Место для коровы</h3><p>Ещё больше заботы и свежее молоко каждый день.<br>Корм: 2 пшеницы за 1 молоко.</p><span class="timer-label">${state.coins < RULES.cowCost ? `Накопите ещё ${RULES.cowCost - state.coins} мон.` : 'Всё готово к её приезду'}</span><button id="buy-cow" class="secondary" ${state.coins < RULES.cowCost ? 'disabled' : ''}>Купить · ${RULES.cowCost} мон.</button></article>` : ''}</div><p class="season-note">Животные не заболеют и спокойно дождутся вас.</p>`;
}

function renderMarket() {
  $('game-content').innerHTML = `<p class="market-title">Продавайте по одной единице. Оставьте немного пшеницы для животных — она ещё пригодится.</p><div class="market-grid">${Object.entries(PRODUCTS).map(([id, p]) => `<article class="market-card"><div class="market-art" aria-hidden="true">${p.icon}</div><h3>${p.name}</h3><span class="stock">В амбаре: ${state.inventory[id]} шт.</span><p>Цена: ${p.price} мон. за штуку</p><button class="primary" id="sell-${id}" data-sell="${id}" ${state.inventory[id] < 1 ? 'disabled' : ''}>Продать 1 · ${p.price} мон.</button></article>`).join('')}</div>`;
}

function render() {
  if (!state) return;
  $('coins').textContent = state.coins;
  const sections = {
    plots: ['Мои грядки', 'ОТ СЕМЕЧКА ДО УРОЖАЯ', `${state.plots.filter(Boolean).length} посажено · ${state.plots.length} грядок`],
    animals: ['Мои животные', 'ЗАБОТА ВОЗВРАЩАЕТСЯ', `${state.animals.length} на ферме`],
    market: ['Фермерский рынок', 'ДЕЛИТЬСЯ ТЕМ, ЧТО ВЫРОСЛО', 'Без спешки и торга'],
  };
  const [title, kicker, count] = sections[tab];
  $('section-title').textContent = title;
  $('section-kicker').textContent = kicker;
  $('section-count').textContent = count;
  if (tab === 'plots') renderPlots();
  if (tab === 'animals') renderAnimals();
  if (tab === 'market') renderMarket();
  $('inventory').innerHTML = Object.entries(PRODUCTS).map(([id, p]) => `<div class="inventory-row"><span class="item-icon" aria-hidden="true">${p.icon}</span><span>${p.name}</span><strong>${state.inventory[id]}</strong></div>`).join('');
  const goals = [
    [state.progress.harvested > 0, 'Собрать первый урожай'],
    [state.progress.fed > 0, 'Накормить курицу'],
    [state.plots.length > RULES.startPlots, 'Открыть новую грядку'],
    [state.animals.some(a => a.type === 'cow'), 'Поселить корову'],
  ];
  $('goals').innerHTML = goals.map(([done, title], i) => `<li class="${done ? 'done' : ''}"><span class="check" aria-hidden="true">${done ? '✓' : i + 1}</span><span>${title}${done ? '<span class="sr-only"> — выполнено</span>' : ''}</span></li>`).join('');
  updateTimers();
}

// Таймер меняет лишь нужные узлы: фокус и нажатия не теряются от
// ежесекундной замены всего DOM. Сбор остаётся явным действием игрока.
function updateTimers() {
  for (const el of document.querySelectorAll('[data-ready-at]')) {
    const at = Number(el.dataset.readyAt);
    const ready = Date.now() >= at;
    if (el.classList.contains('plot-status')) {
      el.textContent = ready ? 'Собрать урожай' : 'Растёт · ' + timeLeft(at);
      const btn = el.closest('button');
      btn.classList.toggle('ready', ready);
      if (ready && !btn.dataset.isReady) {
        btn.dataset.isReady = 'true';
        btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace(', растёт', ', собрать урожай'));
        const index = Number(btn.dataset.plot);
        btn.querySelector('.plant-art').outerHTML = plantArt(state.plots[index].crop, true);
      }
    } else {
      el.textContent = ready ? 'Можно забирать!' : 'Отдыхает · ' + timeLeft(at);
      const button = el.parentElement.querySelector('[data-animal]');
      button.disabled = !ready;
      button.textContent = ready ? 'Забрать продукцию' : 'Готовится…';
    }
  }
  for (const progress of document.querySelectorAll('[data-progress]')) {
    const percent = Math.max(0, Math.min(100, (1 - (Number(progress.dataset.progress) - Date.now()) / Number(progress.dataset.duration)) * 100));
    progress.style.width = percent + '%';
  }
}

$('game-content').addEventListener('click', event => {
  const b = event.target.closest('button');
  if (!b || b.disabled || frozen) return;
  if (b.dataset.plot !== undefined) {
    const index = Number(b.dataset.plot);
    const plot = state.plots[index];
    if (plot && Date.now() >= plot.readyAt) perform({ type: 'harvest', plot: index }, `В амбаре +${CROPS[plot.crop].yield} · ${CROPS[plot.crop].name}`);
    else if (plot) notice(`Ещё немного: ${timeLeft(plot.readyAt)} до урожая.`);
    else { chosenPlot = index; cropOptions(); showDialog('seed-dialog'); }
  }
  if (b.dataset.animal !== undefined) {
    const index = Number(b.dataset.animal);
    const action = state.animals[index].readyAt === null ? 'feed' : 'collect';
    perform({ type: action, animal: index }, action === 'feed' ? 'Спасибо за заботу! Продукция скоро будет готова.' : 'Свежая продукция уже в амбаре.');
  }
  if (b.dataset.sell) perform({ type: 'sell', product: b.dataset.sell, count: 1 }, `Продано! +${PRODUCTS[b.dataset.sell].price} мон.`);
  if (b.id === 'buy-plot') perform({ type: 'buyPlot' }, 'Новая грядка ждёт свои первые семена!');
  if (b.id === 'buy-cow') perform({ type: 'buyCow' }, 'На вашей ферме поселилась корова!');
  if (b.id === 'rescue') perform({ type: 'rescue' }, 'Бесплатные семена пшеницы получены. Выберите грядку.');
});
$('seed-options').addEventListener('click', event => {
  const button = event.target.closest('[data-plant]');
  if (!button || button.disabled) return;
  $('seed-dialog').close();
  perform({ type: 'plant', plot: chosenPlot, crop: button.dataset.plant }, 'Семена посажены. Теперь немного терпения!');
});
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  tab = button.dataset.tab;
  for (const b of document.querySelectorAll('[data-tab]')) {
    if (b === button) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  render();
});
window.addEventListener('storage', event => { if ((event.key === SAVE_KEY || event.key === null) && storage.isChanged() && state) conflict(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (storage.isChanged() && state) conflict(); else updateTimers(); } });
$('reload-save').addEventListener('click', () => location.reload());

if (!state) {
  warning(loaded.message);
  const paragraph = document.createElement('p');
  paragraph.textContent = 'Игра приостановлена. Для восстановления используйте совместимую версию игры или сохранённую копию данных.';
  $('game-content').append(paragraph);
  const restart = document.createElement('button');
  restart.className = 'secondary';
  restart.textContent = 'Начать новую ферму';
  restart.addEventListener('click', () => showDialog('reset-dialog'));
  $('game-content').append(restart);
} else {
  render();
  syncStatus(loaded.status);
  if (loaded.status === 'new') syncStatus(storage.save(state).status);
}
$('confirm-new').addEventListener('click', () => {
  const result = storage.startNew();
  if (result.status === 'saved') location.reload();
  else { $('reset-dialog').close(); warning('Не удалось заменить сохранение. Возможно, оно изменилось в другой вкладке. Перезагрузите страницу.'); }
});
setInterval(() => { if (!document.hidden && !frozen) updateTimers(); }, 500);
