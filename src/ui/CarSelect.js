function clampChannel(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Lightens (positive amt) or darkens (negative amt) a 0xRRGGBB color by
 * blending each channel toward white/black — simple and dependency-free,
 * no need to pull in THREE's HSL machinery for a pure-DOM picker. */
function shadeColor(hex, amt) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const target = amt > 0 ? 255 : 0;
  const t = Math.abs(amt);
  const nr = clampChannel(r + (target - r) * t);
  const ng = clampChannel(g + (target - g) * t);
  const nb = clampChannel(b + (target - b) * t);
  return (nr << 16) | (ng << 8) | nb;
}

function toHexString(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

export function createCarSelect(container, carDefs, { onConfirm }) {
  const el = document.createElement('div');
  el.className = 'screen car-select';
  el.innerHTML = `
    <h2>Select Cars</h2>
    <p class="subtitle">Click to pick Player 1, click again to pick Player 2 &middot; remaining 3 race as AI</p>
    <div class="grid car-grid"></div>
    <button class="btn btn-primary" id="confirm-btn" disabled>Start Race</button>
  `;
  container.appendChild(el);

  const grid = el.querySelector('.car-grid');
  const confirmBtn = el.querySelector('#confirm-btn');
  let p1 = null;
  let p2 = null;
  const cardsByDef = new Map();
  const selectedTrim = new Map(); // def -> chosen color hex (defaults to def.color)

  function render() {
    for (const [def, card] of cardsByDef) {
      card.classList.remove('picked-p1', 'picked-p2');
      const tag = card.querySelector('.pick-tag');
      tag.textContent = '';
      if (def === p1) { card.classList.add('picked-p1'); tag.textContent = 'P1'; }
      if (def === p2) { card.classList.add('picked-p2'); tag.textContent = 'P2'; }
    }
    confirmBtn.disabled = !(p1 && p2);
  }

  for (const def of carDefs) {
    const card = document.createElement('button');
    card.className = 'card car-card';
    card.style.setProperty('--card-color', toHexString(def.color));
    const trims = [def.color, shadeColor(def.color, 0.35), shadeColor(def.color, -0.35)];
    selectedTrim.set(def, def.color);
    const swatchesHtml = trims
      .map((c, i) => `<span class="trim-swatch${i === 0 ? ' trim-active' : ''}" data-trim="${c}" style="background:${toHexString(c)}"></span>`)
      .join('');
    card.innerHTML = `
      <div class="card-swatch"></div>
      <div class="card-label">${def.name}</div>
      <div class="pick-tag"></div>
      <div class="trim-row">${swatchesHtml}</div>
    `;
    card.addEventListener('click', () => {
      if (def === p1) { p1 = null; }
      else if (def === p2) { p2 = null; }
      else if (!p1) { p1 = def; }
      else if (!p2 && def !== p1) { p2 = def; }
      render();
    });
    for (const swatch of card.querySelectorAll('.trim-swatch')) {
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedTrim.set(def, parseInt(swatch.dataset.trim, 10));
        for (const s of card.querySelectorAll('.trim-swatch')) s.classList.remove('trim-active');
        swatch.classList.add('trim-active');
        card.style.setProperty('--card-color', toHexString(selectedTrim.get(def)));
      });
    }
    grid.appendChild(card);
    cardsByDef.set(def, card);
  }

  confirmBtn.addEventListener('click', () => {
    if (!(p1 && p2)) return;
    // Building the race (physics world + a ~100+ segment track + 5 cars) is
    // heavy enough to block the main thread for a couple hundred ms. Giving
    // immediate visual feedback and deferring that work to a macrotask lets
    // the disabled/loading state actually paint first, instead of the
    // click handler itself blocking the next paint — the thing an
    // Interaction to Next Paint warning flags.
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Loading…';
    // Trim selection is folded into a shallow-cloned def here (not earlier)
    // so identity-based pick/toggle logic above keeps comparing against the
    // original carDefs entries undisturbed.
    const p1Trimmed = { ...p1, color: selectedTrim.get(p1) ?? p1.color };
    const p2Trimmed = { ...p2, color: selectedTrim.get(p2) ?? p2.color };
    setTimeout(() => onConfirm(p1Trimmed, p2Trimmed), 0);
  });

  return {
    el,
    show: () => {
      p1 = null;
      p2 = null;
      confirmBtn.textContent = 'Start Race';
      render();
      el.style.display = 'flex';
    },
    hide: () => { el.style.display = 'none'; },
  };
}
