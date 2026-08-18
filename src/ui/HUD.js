export function createHUD(container, { onExit } = {}) {
  const el = document.createElement('div');
  el.className = 'screen hud';
  el.innerHTML = `
    <button class="hud-exit-btn" id="hud-exit-btn" title="Quit to Main Menu">Exit</button>
    <div class="hud-panel hud-p1">
      <div class="hud-name">Player 1</div>
      <div class="hud-bar"><div class="hud-bar-fill" id="hud-p1-bar"></div></div>
      <div class="hud-placement" id="hud-p1-place"></div>
    </div>
    <div class="hud-panel hud-p2">
      <div class="hud-name">Player 2</div>
      <div class="hud-bar"><div class="hud-bar-fill" id="hud-p2-bar"></div></div>
      <div class="hud-placement" id="hud-p2-place"></div>
    </div>
    <div class="hud-toasts" id="hud-toasts"></div>
  `;
  container.appendChild(el);
  el.style.display = 'none';

  el.querySelector('#hud-exit-btn').addEventListener('click', () => onExit?.());

  const p1Bar = el.querySelector('#hud-p1-bar');
  const p2Bar = el.querySelector('#hud-p2-bar');
  const p1Place = el.querySelector('#hud-p1-place');
  const p2Place = el.querySelector('#hud-p2-place');
  const toastsEl = el.querySelector('#hud-toasts');

  const seenEliminated = new Set();

  function stageColor(hp) {
    if (hp < 25) return '#4caf50';
    if (hp < 50) return '#ffb300';
    if (hp < 75) return '#ff6f00';
    return '#c62828';
  }

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'hud-toast';
    t.textContent = text;
    toastsEl.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  function placementOf(entries, target) {
    const progress = target.car.lapProgress;
    let rank = 1;
    for (const e of entries) {
      if (e.car === target.car) continue;
      if (!e.car.eliminated && e.car.lapProgress > progress) rank++;
    }
    return rank;
  }

  function update(raceEntries) {
    const p1 = raceEntries[0];
    const p2 = raceEntries[1];

    p1Bar.style.width = `${Math.min(100, p1.car.damageSystem.hp)}%`;
    p1Bar.style.background = stageColor(p1.car.damageSystem.hp);
    p1Place.textContent = p1.car.eliminated ? 'Eliminated' : `${placementOf(raceEntries, p1)} / ${raceEntries.length}`;

    p2Bar.style.width = `${Math.min(100, p2.car.damageSystem.hp)}%`;
    p2Bar.style.background = stageColor(p2.car.damageSystem.hp);
    p2Place.textContent = p2.car.eliminated ? 'Eliminated' : `${placementOf(raceEntries, p2)} / ${raceEntries.length}`;

    for (const e of raceEntries) {
      if (e.car.eliminated && !seenEliminated.has(e)) {
        seenEliminated.add(e);
        toast(`${e.name} eliminated!`);
      }
    }
  }

  return {
    el,
    update,
    show: () => { seenEliminated.clear(); toastsEl.innerHTML = ''; el.style.display = 'block'; },
    hide: () => { el.style.display = 'none'; },
  };
}
