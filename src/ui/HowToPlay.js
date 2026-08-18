export function createHowToPlay(container, { onBack }) {
  const el = document.createElement('div');
  el.className = 'screen how-to-play';
  el.innerHTML = `
    <h2>How to Play</h2>
    <div class="how-to-play-body">
      <section>
        <h3>The Goal</h3>
        <p>Race your car around the track with a friend! Bump other cars out of the way, dodge the tricky obstacles, and try to be the <strong>last car still racing</strong> — or the <strong>first one to cross the finish line</strong>!</p>
      </section>
      <section>
        <h3>Player 1 Controls</h3>
        <p><strong>W</strong> = Go &nbsp; <strong>S</strong> = Slow Down &nbsp; <strong>A</strong> / <strong>D</strong> = Turn &nbsp; <strong>Space</strong> = Skid Turn</p>
      </section>
      <section>
        <h3>Player 2 Controls</h3>
        <p><strong>&uarr;</strong> = Go &nbsp; <strong>&darr;</strong> = Slow Down &nbsp; <strong>&larr;</strong> / <strong>&rarr;</strong> = Turn &nbsp; <strong>Right Shift</strong> = Skid Turn</p>
      </section>
      <section>
        <h3>Playing on a Phone or Tablet?</h3>
        <p>Buttons pop up right on your screen! Tap the arrows to turn, the up arrow to go, the down arrow to slow down, and the little <strong>HB</strong> button for a fun skid.</p>
      </section>
      <section>
        <h3>Watch Out For...</h3>
        <ul>
          <li><strong>Guard rails</strong> — the walls along the track. Hit one and you'll bounce right off.</li>
          <li><strong>Loops</strong> — you have to go fast enough to make it all the way around, or you'll fall!</li>
          <li><strong>Gaps and moving platforms</strong> — time it just right so you don't fall through.</li>
          <li><strong>Other cars</strong> — crashing hurts your car's health. Lose it all and you're out of the race!</li>
        </ul>
      </section>
      <section>
        <h3>Good to Know</h3>
        <p>Every race has 5 cars: you, your friend, and 3 computer-driven racers. Keep an eye on the health bar at the bottom of your screen — that tells you how banged up your car is. Have fun, and don't be afraid to crash a little!</p>
      </section>
    </div>
    <button class="btn btn-primary" id="how-to-play-back">Back to Menu</button>
  `;
  container.appendChild(el);
  el.style.display = 'none';

  el.querySelector('#how-to-play-back').addEventListener('click', () => onBack?.());

  return {
    el,
    show: () => { el.style.display = 'flex'; },
    hide: () => { el.style.display = 'none'; },
  };
}
