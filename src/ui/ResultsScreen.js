export function createResultsScreen(container, { onRaceAgain, onMainMenu }) {
  const el = document.createElement('div');
  el.className = 'screen results-screen';
  el.innerHTML = `
    <h2>Results</h2>
    <ol class="results-list" id="results-list"></ol>
    <div class="results-buttons">
      <button class="btn btn-primary" id="race-again-btn">Race Again</button>
      <button class="btn" id="main-menu-btn">Main Menu</button>
    </div>
  `;
  container.appendChild(el);

  const list = el.querySelector('#results-list');
  const raceAgainBtn = el.querySelector('#race-again-btn');
  raceAgainBtn.addEventListener('click', () => {
    // Same deferred-work pattern as Car Select's Start Race button — this
    // also triggers a full track/car rebuild, so it gets the same
    // paint-before-blocking treatment.
    raceAgainBtn.disabled = true;
    raceAgainBtn.textContent = 'Loading…';
    setTimeout(onRaceAgain, 0);
  });
  el.querySelector('#main-menu-btn').addEventListener('click', onMainMenu);

  return {
    el,
    show: (placements) => {
      list.innerHTML = placements.map((name) => `<li>${name}</li>`).join('');
      raceAgainBtn.disabled = false;
      raceAgainBtn.textContent = 'Race Again';
      el.style.display = 'flex';
    },
    hide: () => { el.style.display = 'none'; },
  };
}
