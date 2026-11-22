import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_KEY, FarmAudio, loadAudio, saveAudio, normalizeAudio } from './audio.mjs';
import { animalSamples } from './animal-sounds.mjs';

function environment() {
  const timers = new Map();
  const contexts = [];
  class Param {
    value = 0;
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
  }
  class Node {
    gain = new Param();
    frequency = new Param();
    disconnected = false;
    connect() {}
    disconnect() { this.disconnected = true; }
    start(t) { this.startAt = t; }
    stop(t = 0) { this.stopAt = t; }
  }
  class Context {
    sampleRate = 48000;
    state = 'suspended';
    currentTime = 0;
    destination = new Node();
    constructor() { contexts.push(this); }
    createGain() { return new Node(); }
    createOscillator() { return new Node(); }
    createBufferSource() { return new Node(); }
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  let nextID = 0;
  return { AudioContext: Context, contexts, timers,
    setInterval(fn) { const id = ++nextID; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); } };
}

test('настройки нормализуются и сохраняются отдельно от игрового прогресса', () => {
  const data = new Map([['farm.save.v1', 'игровой прогресс']]);
  const store = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(normalizeAudio({ music: 'нет', effects: false, musicVolume: -20, effectsVolume: Infinity }),
    { music: true, effects: false, musicVolume: 0, effectsVolume: 55 });
  assert.equal(saveAudio(() => store, { music: false, effects: true, musicVolume: 123, effectsVolume: 10 }), true);
  assert.equal(data.get('farm.save.v1'), 'игровой прогресс');
  assert.deepEqual(loadAudio(() => store).preferences, { music: false, effects: true, musicVolume: 100, effectsVolume: 10 });
  data.set(AUDIO_KEY, '{');
  assert.equal(loadAudio(() => store).saved, false);
  assert.equal(data.get(AUDIO_KEY), '{');
  assert.equal(saveAudio(() => { throw new Error('квота'); }, {}), false);
});

test('до жеста контекст не создаётся; повторные unlock не создают копий музыки', async () => {
  const env = environment();
  const audio = new FarmAudio(env);
  audio.configure({ music: true, effects: true, musicVolume: 30, effectsVolume: 55 });
  audio.effect('plant');
  assert.equal(env.contexts.length, 0);
  await Promise.all([audio.unlock(), audio.unlock(), audio.unlock()]);
  assert.equal(env.contexts.length, 1);
  assert.equal(env.timers.size, 1);
  assert.ok([...audio.voices].some(v => v.channel === 'music'));
  await audio.unlock();
  assert.equal(env.timers.size, 1);
  audio.dispose();
});

test('каналы и нулевая громкость выключаются независимо', async () => {
  const env = environment();
  const audio = new FarmAudio(env);
  await audio.unlock();
  audio.effect('harvest');
  assert.ok([...audio.voices].some(v => v.channel === 'effects'));
  audio.configure({ music: false, effects: true, musicVolume: 30, effectsVolume: 55 });
  assert.equal(env.timers.size, 0);
  assert.equal([...audio.voices].some(v => v.channel === 'music'), false);
  assert.ok([...audio.voices].some(v => v.channel === 'effects'));
  audio.configure({ music: true, effects: true, musicVolume: 30, effectsVolume: 0 });
  assert.equal(env.timers.size, 1);
  assert.equal([...audio.voices].some(v => v.channel === 'effects'), false);
  const count = audio.voices.size;
  audio.effect('sell');
  assert.equal(audio.voices.size, count);
  audio.configure({ music: true, effects: true, musicVolume: 0, effectsVolume: 0 });
  assert.equal(env.timers.size, 0); assert.equal(audio.voices.size, 0);
  audio.dispose();
});

test('фон и закрытие останавливают контекст, таймеры и все голоса', async () => {
  const env = environment();
  const audio = new FarmAudio(env);
  await audio.unlock(); audio.effect('buyCow');
  const voices = [...audio.voices];
  audio.setActive(false);
  assert.equal(env.contexts[0].state, 'suspended');
  assert.equal(env.timers.size, 0); assert.equal(audio.voices.size, 0);
  assert.ok(voices.every(v => v.osc.disconnected && v.envelope.disconnected));
  audio.effect('plant'); assert.equal(audio.voices.size, 0);
  audio.setActive(true); await audio.pending;
  assert.equal(env.contexts[0].state, 'running'); assert.equal(env.timers.size, 1);
  audio.dispose();
  assert.equal(env.contexts[0].state, 'closed'); assert.equal(env.timers.size, 0);
  assert.equal(await audio.unlock(), false);
});

test('уход в фон во время ожидающего resume не запускает музыку', async () => {
  const env = environment();
  let finish;
  const NativeContext = env.AudioContext;
  env.AudioContext = class extends NativeContext {
    resume() { return new Promise(resolve => { finish = () => { this.state = 'running'; resolve(); }; }); }
  };
  const audio = new FarmAudio(env);
  const pending = audio.unlock();
  audio.setActive(false);
  finish();
  assert.equal(await pending, false);
  assert.equal(env.contexts[0].state, 'suspended'); assert.equal(env.timers.size, 0);
  audio.dispose();
});

test('отсутствие API, отказ контекста и исключение генератора безопасны', async () => {
  const unsupported = new FarmAudio({});
  assert.equal(await unsupported.unlock(), false);
  assert.doesNotThrow(() => { unsupported.effect('sell'); unsupported.setActive(false); });
  const deniedEnv = environment();
  deniedEnv.AudioContext = class { constructor() { throw new Error('запрещено'); } };
  const denied = new FarmAudio(deniedEnv);
  assert.equal(await denied.unlock(), false); assert.equal(denied.available, false);
  const rejectedEnv = environment();
  const Native = rejectedEnv.AudioContext;
  rejectedEnv.AudioContext = class extends Native { async resume() { throw new Error('resume запрещён'); } };
  const rejected = new FarmAudio(rejectedEnv);
  assert.equal(await rejected.unlock(), false);
  assert.equal(rejected.available, false); assert.equal(rejectedEnv.timers.size, 0);
  const firstTickEnv = environment();
  const FirstContext = firstTickEnv.AudioContext;
  firstTickEnv.AudioContext = class extends FirstContext { createOscillator() { throw new Error('генератор недоступен'); } };
  const firstTick = new FarmAudio(firstTickEnv);
  assert.equal(await firstTick.unlock(), false);
  assert.equal(firstTick.available, false); assert.equal(firstTickEnv.timers.size, 0);
  const env = environment(); const audio = new FarmAudio(env);
  await audio.unlock();
  env.contexts[0].createOscillator = () => { throw new Error('аудио отказало'); };
  assert.doesNotThrow(() => audio.effect('harvest'));
  assert.equal(audio.available, false); assert.equal(env.timers.size, 0);
});

test('животные звучат раздельно; их голоса выключаются и освобождаются', async () => {
  const audio = new FarmAudio(environment());
  audio.configure({ music: false });
  await audio.unlock();
  audio.effect('feed', 'chicken');
  audio.effect('collect', 'cow');
  audio.effect('buyCow');
  const voices = [...audio.voices];
  assert.equal(voices.length, 3);
  assert.notEqual(voices[0].osc.buffer, voices[1].osc.buffer);
  assert.equal(voices[1].osc.buffer, voices[2].osc.buffer);
  voices[0].osc.onended();
  assert.equal(voices[0].osc.disconnected, true);
  audio.configure({ music: false, effects: false });
  assert.equal(audio.voices.size, 0);
  audio.effect('feed', 'cow');
  assert.equal(audio.voices.size, 0);
  audio.configure({ music: false, effects: true });
  for (let i = 0; i < 60; i++) audio.effect('buyCow');
  assert.equal(audio.voices.size, 48);
  audio.setActive(false);
  assert.equal(audio.voices.size, 0);
  audio.dispose();
});

test('синтез животных создаёт ограниченный сигнал без щелчков на краях', () => {
  for (const rate of [22050, 44100, 48000]) {
    for (const animal of ['chicken', 'cow']) {
      const samples = animalSamples(animal, rate);
      assert.ok(samples.length > rate * 0.9);
      assert.ok(samples.every(v => Number.isFinite(v) && Math.abs(v) < 1));
      assert.ok(samples.some(v => Math.abs(v) > 0.1));
      assert.ok(Math.abs(samples[0]) < 0.001);
      assert.ok(Math.abs(samples.at(-1)) < 0.001);
    }
  }
});

test('отказ воспроизведения животного безопасен для игры', async () => {
  const env = environment();
  const audio = new FarmAudio(env);
  await audio.unlock();
  env.contexts[0].createBufferSource = () => { throw new Error('отказ источника'); };
  assert.doesNotThrow(() => audio.effect('feed', 'cow'));
  assert.equal(audio.available, false);
  assert.equal(audio.voices.size, 0);
  assert.equal(env.timers.size, 0);
});

test('голоса освобождаются; быстрые события ограничены; задержка не копит ноты', async () => {
  const env = environment(); const audio = new FarmAudio(env);
  await audio.unlock();
  const voice = [...audio.voices][0];
  voice.osc.onended();
  assert.equal(audio.voices.has(voice), false); assert.equal(voice.envelope.disconnected, true);
  audio.stopVoices();
  env.contexts[0].currentTime = 200;
  audio.tick();
  assert.ok(audio.voices.size < 10, 'не воспроизводим 200 секунд накопленных нот');
  for (let i = 0; i < 100; i++) audio.effect('buyPlot');
  assert.ok(audio.voices.size <= 48);
  audio.dispose(); assert.equal(audio.voices.size, 0);
});
