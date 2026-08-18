export function createHUD(container, { onExit } = {}) {
  const el = document.createElement('div');
  el.className = 'screen hud';
  el.innerHTML = `
    <button class="hud-exit-btn" id="hud-exit-btn" title="Quit to Main Menu">Exit</button>
    <div class="hud-timer" id="hud-timer">0:00</div>
    <div class="hud-panel hud-p1">
      <div class="hud-name">Player 1</div>
      <div class="hud-bar"><div class="hud-bar-fill" id="hud-p1-bar"></div></div>
      <div class="hud-placement" id="hud-p1-place"></div>
      <div class="hud-progress" id="hud-p1-progress"></div>
    </div>
    <div class="hud-panel hud-p2">
      <div class="hud-name">Player 2</div>
      <div class="hud-bar"><div class="hud-bar-fill" id="hud-p2-bar"></div></div>
      <div class="hud-placement" id="hud-p2-place"></div>
      <div class="hud-progress" id="hud-p2-progress"></div>
    </div>
    <div class="hud-toasts" id="hud-toasts"></div>
  `;
  container.appendChild(el);
  el.style.display = 'none';

  el.querySelector('#hud-exit-btn').addEventListener('click', () => onExit?.());

  const timerEl = el.querySelector('#hud-timer');
  const p1Bar = el.querySelector('#hud-p1-bar');
  const p2Bar = el.querySelector('#hud-p2-bar');
  const p1Place = el.querySelector('#hud-p1-place');
  const p2Place = el.querySelector('#hud-p2-place');
  const p1Progress = el.querySelector('#hud-p1-progress');
  const p2Progress = el.querySelector('#hud-p2-progress');
  const toastsEl = el.querySelector('#hud-toasts');

  const seenEliminated = new Set();
  let leader = null;

  function stageColor(hp) {
    if (hp < 25) return '#4caf50';
    if (hp < 50) return '#ffb300';
    if (hp < 75) return '#ff6f00';
    return '#c62828';
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

  function update(raceEntries, meta = {}) {
    const { totalLength = 0, elapsed = 0 } = meta;
    const p1 = raceEntries[0];
    const p2 = raceEntries[1];

    timerEl.textContent = formatTime(elapsed);

    p1Bar.style.width = `${Math.min(100, p1.car.damageSystem.hp)}%`;
    p1Bar.style.background = stageColor(p1.car.damageSystem.hp);
    p1Place.textContent = p1.car.eliminated ? 'Eliminated' : `${placementOf(raceEntries, p1)} / ${raceEntries.length}`;
    p1Progress.textContent = totalLength > 0 ? `${Math.min(100, Math.floor((p1.car.lapProgress / totalLength) * 100))}%` : '';

    p2Bar.style.width = `${Math.min(100, p2.car.damageSystem.hp)}%`;
    p2Bar.style.background = stageColor(p2.car.damageSystem.hp);
    p2Place.textContent = p2.car.eliminated ? 'Eliminated' : `${placementOf(raceEntries, p2)} / ${raceEntries.length}`;
    p2Progress.textContent = totalLength > 0 ? `${Math.min(100, Math.floor((p2.car.lapProgress / totalLength) * 100))}%` : '';

    for (const e of raceEntries) {
      if (e.car.eliminated && !seenEliminated.has(e)) {
        seenEliminated.add(e);
        toast(`${e.name} eliminated!`);
      }
    }

    // Lead change: whoever has the highest lapProgress among cars still
    // racing. Skipped on the very first update (leader starts null) so the
    // initial grid order doesn't fire a spurious "takes the lead" toast.
    const active = raceEntries.filter((e) => !e.car.eliminated);
    if (active.length > 0) {
      const currentLeader = active.reduce((a, b) => (b.car.lapProgress > a.car.lapProgress ? b : a));
      if (leader !== null && currentLeader !== leader) {
        toast(`${currentLeader.name} takes the lead!`);
      }
      leader = currentLeader;
    }
  }

  return {
    el,
    update,
    show: () => { seenEliminated.clear(); toastsEl.innerHTML = ''; leader = null; el.style.display = 'block'; },
    hide: () => { el.style.display = 'none'; },
  };
}
