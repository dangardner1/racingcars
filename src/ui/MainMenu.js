export function createMainMenu(container, { onStart, onHowToPlay }) {
  const el = document.createElement('div');
  el.className = 'screen main-menu';
  el.innerHTML = `
    <h1>Battle Racer</h1>
    <p class="subtitle">2 local players &middot; 5-car figure-eight races &middot; last car standing</p>
    <button class="btn btn-primary" id="start-btn">2-Player Race</button>
    <button class="btn" id="how-to-play-btn">How to Play</button>
    <p class="controls-hint">
      Player 1: W/S throttle &middot; A/D steer &middot; Space handbrake<br>
      Player 2: Arrow Up/Down throttle &middot; Left/Right steer &middot; Right Shift handbrake
    </p>
  `;
  container.appendChild(el);
  el.querySelector('#start-btn').addEventListener('click', onStart);
  el.querySelector('#how-to-play-btn').addEventListener('click', () => onHowToPlay?.());

  return {
    el,
    show: () => { el.style.display = 'flex'; },
    hide: () => { el.style.display = 'none'; },
  };
}
