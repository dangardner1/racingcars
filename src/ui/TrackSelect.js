export function createTrackSelect(container, tracks, { onSelect }) {
  const el = document.createElement('div');
  el.className = 'screen track-select';
  el.innerHTML = `<h2>Select Track</h2><div class="grid track-grid"></div>`;
  container.appendChild(el);

  const grid = el.querySelector('.track-grid');
  for (const track of tracks) {
    const card = document.createElement('button');
    card.className = 'card track-card';
    card.style.setProperty('--card-color', track.skyColor);
    const label = track.theme.replace(/_/g, ' ');
    card.innerHTML = `<div class="card-swatch"></div><div class="card-label">${label}</div>`;
    card.addEventListener('click', () => onSelect(track));
    grid.appendChild(card);
  }

  return {
    el,
    show: () => { el.style.display = 'flex'; },
    hide: () => { el.style.display = 'none'; },
  };
}
