import { setVirtualKey } from '../input/InputManager.js';

/**
 * On-screen touch equivalent of the keyboard controls, built from the same
 * key-code bindings (P1_KEYS/P2_KEYS) so it drives readInput() through
 * InputManager's shared `pressed` set instead of needing its own input path.
 * Visibility is handled entirely by CSS (`.touch-controls` is hidden for
 * fine-pointer/hover-capable devices in style.css) — a real keyboard-and-
 * mouse desktop never sees this overlay, a touch device always does,
 * regardless of window width.
 */
export function createTouchControls(container, p1Keys, p2Keys) {
  const el = document.createElement('div');
  el.className = 'touch-controls';
  el.innerHTML = `
    <div class="touch-cluster touch-p1">
      <button class="touch-btn touch-handbrake" data-key="${p1Keys.handbrake}">HB</button>
      <div class="touch-row">
        <div class="touch-steer">
          <button class="touch-btn" data-key="${p1Keys.turnLeft}">&#9664;</button>
          <button class="touch-btn" data-key="${p1Keys.turnRight}">&#9654;</button>
        </div>
        <div class="touch-pedals">
          <button class="touch-btn" data-key="${p1Keys.throttle}">&#9650;</button>
          <button class="touch-btn" data-key="${p1Keys.brake}">&#9660;</button>
        </div>
      </div>
    </div>
    <div class="touch-cluster touch-p2">
      <button class="touch-btn touch-handbrake" data-key="${p2Keys.handbrake}">HB</button>
      <div class="touch-row">
        <div class="touch-steer">
          <button class="touch-btn" data-key="${p2Keys.turnLeft}">&#9664;</button>
          <button class="touch-btn" data-key="${p2Keys.turnRight}">&#9654;</button>
        </div>
        <div class="touch-pedals">
          <button class="touch-btn" data-key="${p2Keys.throttle}">&#9650;</button>
          <button class="touch-btn" data-key="${p2Keys.brake}">&#9660;</button>
        </div>
      </div>
    </div>
  `;
  container.appendChild(el);
  el.style.display = 'none';

  // Each button tracks its own pressed touches by identifier so one finger
  // sliding off doesn't release a button another finger is still holding,
  // and so two players' fingers on different buttons never interfere.
  for (const btn of el.querySelectorAll('.touch-btn')) {
    const code = btn.dataset.key;
    const activeTouches = new Set();

    const press = () => {
      btn.classList.add('touch-active');
      setVirtualKey(code, true);
    };
    const release = () => {
      btn.classList.remove('touch-active');
      setVirtualKey(code, false);
    };

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) activeTouches.add(t.identifier);
      press();
    }, { passive: false });

    const endTouch = (e) => {
      for (const t of e.changedTouches) activeTouches.delete(t.identifier);
      if (activeTouches.size === 0) release();
    };
    btn.addEventListener('touchend', endTouch);
    btn.addEventListener('touchcancel', endTouch);

    // Mouse fallback (devtools touch emulation, or a pointer-coarse laptop
    // touchscreen that also fires mouse events) so the overlay is testable
    // without a real touch device.
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); press(); });
    window.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', () => { if (activeTouches.size === 0) release(); });
  }

  return {
    el,
    show: () => { el.style.display = 'flex'; },
    hide: () => { el.style.display = 'none'; },
  };
}
