// Каталог отделён от правил: новую культуру можно добавить одной записью.
export const CROPS = Object.freeze({
  wheat: { name: 'Пшеница', icon: '🌾', seed: 2, seconds: 20, yield: 3, price: 2, color: '#e9b94c' },
  carrot: { name: 'Морковь', icon: '🥕', seed: 4, seconds: 40, yield: 3, price: 3, color: '#ee9852' },
  corn: { name: 'Кукуруза', icon: '🌽', seed: 6, seconds: 60, yield: 3, price: 5, color: '#e6cb5b' },
});
export const ANIMALS = Object.freeze({
  chicken: { name: 'Курица', icon: '🐔', feed: 1, seconds: 30, product: 'egg' },
  cow: { name: 'Корова', icon: '🐄', feed: 2, seconds: 60, product: 'milk' },
});
export const PRODUCTS = Object.freeze({
  ...CROPS,
  egg: { name: 'Яйцо', icon: '🥚', price: 8 },
  milk: { name: 'Молоко', icon: '🥛', price: 20 },
});
export const RULES = Object.freeze({ startCoins: 60, startPlots: 6, maxPlots: 12, plotCost: 40, cowCost: 100 });
