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
    card.style.setProperty('--card-color', '#' + def.color.toString(16).padStart(6, '0'));
    card.innerHTML = `<div class="card-swatch"></div><div class="card-label">${def.name}</div><div class="pick-tag"></div>`;
    card.addEventListener('click', () => {
      if (def === p1) { p1 = null; }
      else if (def === p2) { p2 = null; }
      else if (!p1) { p1 = def; }
      else if (!p2 && def !== p1) { p2 = def; }
      render();
    });
    grid.appendChild(card);
    cardsByDef.set(def, card);
  }

  confirmBtn.addEventListener('click', () => {
    if (p1 && p2) onConfirm(p1, p2);
  });

  return {
    el,
    show: () => {
      p1 = null;
      p2 = null;
      render();
      el.style.display = 'flex';
    },
    hide: () => { el.style.display = 'none'; },
  };
}
