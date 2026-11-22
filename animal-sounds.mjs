// Локальный синтез голосов: форманты придают мычанию гласный тембр,
// а короткие нисходящие импульсы образуют кудахтанье. Внешних записей нет.
export function animalSamples(animal, sampleRate) {
  if (!['chicken', 'cow'].includes(animal)) return null;
  const duration = animal === 'cow' ? 1.35 : 0.95;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  let phase = 0;
  let noiseState = 73;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    let value = 0;
    if (animal === 'cow') {
      const u = t / duration;
      const pitch = 105 + 30 * Math.sin(Math.PI * u) + 2 * Math.sin(2 * Math.PI * 5 * t);
      phase += 2 * Math.PI * pitch / sampleRate;
      // Переход «м → у»: сначала приглушённый носовой звук, затем гласная.
      const opening = Math.min(1, t / 0.23);
      for (let h = 1; h <= 18; h++) {
        const hz = h * pitch;
        const formants = 0.8 * Math.exp(-(((hz - 330) / 140) ** 2))
          + 0.45 * Math.exp(-(((hz - 850) / 210) ** 2));
        value += Math.sin(h * phase) * (0.15 / h + opening * formants / 5);
      }
      value *= Math.min(1, t / 0.09) * Math.min(1, (duration - t) / 0.25);
    } else {
      // Три коротких «ко» и протяжное «ко-ко-ко»: паузы отделяют слоги.
      const calls = [[0, 0.12], [0.18, 0.11], [0.35, 0.13], [0.53, 0.36]];
      for (const [start, length] of calls) {
        const u = (t - start) / length;
        if (u < 0 || u >= 1) continue;
        const pitch = 650 - 360 * u + 35 * Math.sin(12 * Math.PI * u);
        phase += 2 * Math.PI * pitch / sampleRate;
        // Детерминированный шум добавляет хрипотцу без случайных скачков между запусками.
        noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
        const noise = noiseState / 2 ** 31 - 1;
        value = (0.43 * Math.sin(phase) + 0.23 * Math.sin(2 * phase)
          + 0.12 * Math.sin(3 * phase) + 0.06 * noise)
          * Math.sin(Math.PI * u) ** 0.7;
      }
    }
    samples[i] = value * 0.65;
  }
  return samples;
}
