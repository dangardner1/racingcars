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
  el.querySelector('#race-again-btn').addEventListener('click', onRaceAgain);
  el.querySelector('#main-menu-btn').addEventListener('click', onMainMenu);

  return {
    el,
    show: (placements) => {
      list.innerHTML = placements.map((name) => `<li>${name}</li>`).join('');
      el.style.display = 'flex';
    },
    hide: () => { el.style.display = 'none'; },
  };
}
