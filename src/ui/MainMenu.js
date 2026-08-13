export function createMainMenu(container, { onStart }) {
  const el = document.createElement('div');
  el.className = 'screen main-menu';
  el.innerHTML = `
    <h1>Battle Racer</h1>
    <p class="subtitle">2 local players &middot; 11 cars &middot; last car standing</p>
    <button class="btn btn-primary" id="start-btn">2-Player Race</button>
    <p class="controls-hint">
      Player 1: W/S throttle &middot; A/D lean &middot; Space handbrake<br>
      Player 2: Arrow Up/Down throttle &middot; Left/Right lean &middot; Right Shift handbrake
    </p>
  `;
  container.appendChild(el);
  el.querySelector('#start-btn').addEventListener('click', onStart);

  return {
    el,
    show: () => { el.style.display = 'flex'; },
    hide: () => { el.style.display = 'none'; },
  };
}
