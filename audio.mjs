import { animalSamples } from './animal-sounds.mjs';

// Оригинальная спокойная мелодия и эффекты синтезируются на устройстве.
// Движок не знает о ферме и никогда не изменяет игровое состояние.
export const MUSIC = Object.freeze({ bpm: 78, stepsPerBeat: 2, stepsPerBar: 8 });
export const AUDIO_KEY = 'farm.audio.v1';
export const DEFAULT_AUDIO = Object.freeze({ music: true, effects: true, musicVolume: 30, effectsVolume: 55 });
const clampVolume = (value, fallback) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.min(100, Math.round(value))) : fallback;

export function normalizeAudio(input) {
  const p = input && typeof input === 'object' ? input : {};
  return {
    music: typeof p.music === 'boolean' ? p.music : DEFAULT_AUDIO.music,
    effects: typeof p.effects === 'boolean' ? p.effects : DEFAULT_AUDIO.effects,
    musicVolume: clampVolume(p.musicVolume, DEFAULT_AUDIO.musicVolume),
    effectsVolume: clampVolume(p.effectsVolume, DEFAULT_AUDIO.effectsVolume),
  };
}

export function loadAudio(getStorage) {
  try {
    return { preferences: normalizeAudio(JSON.parse(getStorage().getItem(AUDIO_KEY))), saved: true };
  } catch { return { preferences: { ...DEFAULT_AUDIO }, saved: false }; }
}

export function saveAudio(getStorage, preferences) {
  try { getStorage().setItem(AUDIO_KEY, JSON.stringify(normalizeAudio(preferences))); return true; }
  catch { return false; }
}

const melody = [
  72, 76, 79, 76, 74, 72, 67, 0,
  69, 72, 77, 76, 74, 72, 69, 0,
  72, 76, 81, 79, 76, 74, 72, 0,
  71, 74, 79, 77, 74, 71, 67, 0,
  72, 74, 76, 79, 76, 74, 72, 0,
  69, 72, 77, 79, 77, 76, 72, 0,
  76, 79, 81, 79, 76, 72, 69, 0,
  71, 74, 79, 74, 71, 67, 72, 0,
];
const roots = [48, 53, 57, 55, 48, 53, 57, 55];
const effects = {
  plant: [55, 60], harvest: [72, 76, 79],
  buyPlot: [60, 64, 67, 72],
  rescue: [67, 72, 76], error: [55, 50],
};
const frequency = note => 440 * 2 ** ((note - 69) / 12);

export class FarmAudio {
  constructor(environment = globalThis, onStatus = () => {}) {
    this.env = environment;
    this.onStatus = onStatus;
    this.available = Boolean(environment.AudioContext || environment.webkitAudioContext);
    this.preferences = { ...DEFAULT_AUDIO };
    this.context = null;
    this.unlocked = false;
    this.active = true;
    this.timer = null;
    this.voices = new Set();
    this.animalBuffers = new Map();
    this.step = 0;
    this.nextAt = 0;
    this.pending = null;
    this.disposed = false;
  }

  report(message = '') {
    this.onStatus({ available: this.available, running: this.context?.state === 'running', message });
  }

  configure(preferences) {
    this.preferences = normalizeAudio(preferences);
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const channel of ['music', 'effects']) {
      const volume = this.preferences[channel] ? this.preferences[channel + 'Volume'] / 100 : 0;
      this[channel].gain.setTargetAtTime(volume, now, 0.025);
      if (!volume) this.stopVoices(channel);
    }
    this.syncMusic();
  }

  // Создаём AudioContext исключительно из обработчика действия пользователя.
  // Ожидающий resume защищён от повторных касаний и ухода вкладки в фон.
  unlock() {
    if (!this.available || this.disposed || !this.active ||
        (!this.preferences.music && !this.preferences.effects)) return Promise.resolve(false);
    if (this.pending) return this.pending;
    this.pending = this.resume().finally(() => { this.pending = null; });
    return this.pending;
  }

  async resume() {
    try {
      if (!this.context) {
        const Context = this.env.AudioContext || this.env.webkitAudioContext;
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.value = 0.65;
        this.master.connect(this.context.destination);
        for (const channel of ['music', 'effects']) {
          this[channel] = this.context.createGain();
          this[channel].connect(this.master);
        }
        this.configure(this.preferences);
        this.context.onstatechange = () => {
          if (!this.available || this.disposed) return;
          // На телефоне контекст может прерваться из-за звонка или блокировки.
          // Не оставляем замороженные эффекты для позднего воспроизведения.
          if (this.context.state !== 'running') { this.stopMusic(); this.stopVoices(); }
          else this.syncMusic();
          this.report();
        };
      }
      await this.context.resume();
      if (!this.active || this.disposed) {
        await this.context.suspend();
        return false;
      }
      this.unlocked = this.context.state === 'running';
      this.syncMusic();
      if (!this.available) return false;
      this.report(this.unlocked ? '' : 'Нажмите на игру, чтобы включить звук.');
      return this.unlocked;
    } catch {
      this.fail();
      return false;
    }
  }

  fail() {
    this.available = false;
    this.unlocked = false;
    this.stopMusic();
    this.stopVoices();
    // Частично созданный контекст также нужно освободить при ошибке API.
    try { this.context?.close()?.catch(() => {}); } catch { /* Отказ звука не останавливает игру. */ }
    this.report('Звук недоступен в этом браузере. Можно продолжать играть без него.');
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) {
      this.stopMusic();
      this.stopVoices();
      try { this.context?.suspend()?.catch(() => {}); } catch { /* Не влияет на ферму. */ }
    } else if (this.unlocked && this.available) {
      void this.unlock();
    }
  }

  tone(note, start, duration, channel, volume, type = 'sine') {
    if (this.voices.size >= 48 || !this.context || !this.active) return;
    const osc = this.context.createOscillator();
    const envelope = this.context.createGain();
    const voice = { osc, envelope, channel };
    osc.type = type;
    osc.frequency.setValueAtTime(frequency(note), start);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(envelope);
    envelope.connect(this[channel]);
    osc.onended = () => this.release(voice);
    this.voices.add(voice);
    osc.start(start);
    osc.stop(start + duration + 0.015);
  }

  release(voice) {
    this.voices.delete(voice);
    voice.osc.onended = null;
    try { voice.osc.disconnect(); voice.envelope.disconnect(); } catch { /* Уже отсоединён. */ }
  }

  stopVoices(channel) {
    for (const voice of [...this.voices]) {
      if (channel && voice.channel !== channel) continue;
      try { voice.osc.stop(); } catch { /* Нота могла уже завершиться. */ }
      this.release(voice);
    }
  }

  stopMusic() {
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
    this.stopVoices('music');
  }

  syncMusic() {
    if (!this.available || !this.active || !this.unlocked || this.context?.state !== 'running' ||
        !this.preferences.music || !this.preferences.musicVolume) { this.stopMusic(); return; }
    if (this.timer !== null) return;
    this.step = 0;
    this.nextAt = this.context.currentTime + 0.035;
    this.tick();
    if (this.available && this.active && this.context.state === 'running') {
      this.timer = this.env.setInterval(() => this.tick(), 60);
    }
  }

  tick() {
    if (!this.active || !this.available || this.context?.state !== 'running') return;
    try {
      const beat = 60 / MUSIC.bpm;
      // После задержки браузера не проигрываем накопленную очередь нот залпом.
      if (this.nextAt < this.context.currentTime - 0.3) this.nextAt = this.context.currentTime + 0.035;
      while (this.nextAt < this.context.currentTime + 0.14) {
        const step = this.step % melody.length;
        const root = roots[Math.floor(step / MUSIC.stepsPerBar)];
        if (melody[step]) this.tone(melody[step], this.nextAt, beat * 0.8, 'music', 0.09, 'triangle');
        if (step % 4 === 0) this.tone(root, this.nextAt, beat * 1.7, 'music', 0.12);
        if (step % 8 === 0) {
          const third = root === 57 ? 3 : 4;
          for (const offset of [12, 12 + third, 19]) this.tone(root + offset, this.nextAt, beat * 2.8, 'music', 0.035);
        }
        this.nextAt += beat / MUSIC.stepsPerBeat;
        this.step++;
      }
    } catch { this.fail(); }
  }

  animal(animal) {
    if (this.voices.size >= 48) return;
    let buffer = this.animalBuffers.get(animal);
    if (!buffer) {
      const samples = animalSamples(animal, this.context.sampleRate);
      if (!samples) return;
      buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.animalBuffers.set(animal, buffer);
    }
    // BufferSource учитывается так же, как нота: выключение эффектов,
    // уход в фон и предел полифонии распространяются и на голоса животных.
    const osc = this.context.createBufferSource();
    const envelope = this.context.createGain();
    const voice = { osc, envelope, channel: 'effects' };
    osc.buffer = buffer;
    envelope.gain.value = 0.7;
    osc.connect(envelope);
    envelope.connect(this.effects);
    osc.onended = () => this.release(voice);
    this.voices.add(voice);
    osc.start(this.context.currentTime + 0.01);
  }

  effect(name, animal) {
    if (!this.available || !this.active || !this.unlocked || this.context?.state !== 'running' ||
        !this.preferences.effects || !this.preferences.effectsVolume) return;
    try {
      if (name === 'feed' || name === 'collect' || name === 'buyCow') {
        this.animal(name === 'buyCow' ? 'cow' : animal);
        return;
      }
      if (name === 'sell') {
        // Два удара с негармоническими обертонами дают металлическое «дзинь»,
        // а не прежнюю последовательность музыкальных нот.
        for (const [delay, volume] of [[0, 0.14], [0.085, 0.09]]) {
          for (const [note, level] of [[96, 1], [103.7, 0.55], [111.2, 0.25]]) {
            this.tone(note, this.context.currentTime + 0.01 + delay, 0.45,
              'effects', volume * level);
          }
        }
        return;
      }
      const notes = effects[name];
      if (!notes) return;
      notes.forEach((note, i) => this.tone(note, this.context.currentTime + 0.01 + i * 0.075,
        name === 'plant' || name === 'feed' ? 0.1 : 0.2, 'effects', 0.16, 'sine'));
    } catch { this.fail(); }
  }

  dispose() {
    this.disposed = true;
    this.setActive(false);
    try { this.context?.close()?.catch(() => {}); } catch { /* Закрытие страницы. */ }
  }
}
