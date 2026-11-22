// Векторные рисунки созданы для проекта. SVG используются только как декор;
// управление и подписи остаются обычными доступными HTML-элементами.
export const scenery = `<svg class="farm-scene" aria-hidden="true" viewBox="0 0 210 110"><ellipse cx="111" cy="101" rx="98" ry="7" fill="#acc18e"/><path d="M23 101V58M39 101V58M55 101V58M13 69H67M13 88H67" stroke="#e9e4bf" stroke-width="5"/><path d="M80 101V47L113 22 147 47V101" fill="#ae6351"/><path d="M74 48L113 17 153 48" fill="none" stroke="#56634b" stroke-width="9" stroke-linejoin="round"/><path d="M96 101V65H131V101" fill="#efe2bd"/><path d="M101 100V71H126V100" fill="#6d7253"/><path d="M102 72L125 98M125 72L102 98" stroke="#efe2bd" stroke-width="3"/><rect x="106" y="40" width="14" height="14" rx="2" fill="#f4dda2"/><path d="M177 102V54" stroke="#7e7152" stroke-width="8"/><circle cx="178" cy="37" r="24" fill="#698d4d"/><circle cx="164" cy="55" r="21" fill="#7d9c56"/><circle cx="187" cy="58" r="22" fill="#5d8348"/><circle cx="179" cy="43" r="4" fill="#dec270"/><circle cx="158" cy="58" r="4" fill="#dec270"/><circle cx="193" cy="62" r="4" fill="#dec270"/></svg>`;

export function plantArt(crop, ready) {
  const positions = [15, 40, 65];
  const stalk = positions.map((x, i) => {
    const y = i === 1 ? 7 : 18;
    if (crop === 'carrot') return `<path d="M${x} 33l-7 4 7 24 7-24z" fill="${ready ? '#f6a14a' : '#b4be67'}"/><path d="M${x} 35q-15-20-9-25 9 5 9 25q2-25 9-25 8 11-9 25" fill="#9ebd65"/>`;
    return `<path d="M${x} 61V${y + 8}" stroke="#a1ba61" stroke-width="3"/><path d="M${x} 48q-16-2-13-13 12 2 13 13m0-10q15-3 13-13-12 2-13 13" fill="#9eb75f"/>${crop === 'corn' ? `<ellipse cx="${x + 2}" cy="${y + 18}" rx="6" ry="15" fill="${ready ? '#f2ce62' : '#b3c473'}"/>` : `<path d="M${x} ${y}q-13 5 0 12 13-7 0-12m0 10q-15 3 0 12 15-9 0-12m0 10q-15 3 0 12 15-9 0-12" fill="${ready ? '#f0cd71' : '#b9c777'}"/>`}`;
  }).join('');
  return `<svg class="plant-art" aria-hidden="true" viewBox="0 0 80 68">${stalk}</svg>`;
}
