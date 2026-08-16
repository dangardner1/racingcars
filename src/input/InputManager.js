const pressed = new Set();

window.addEventListener('keydown', (e) => {
  pressed.add(e.code);
});
window.addEventListener('keyup', (e) => {
  pressed.delete(e.code);
});
window.addEventListener('blur', () => {
  pressed.clear();
});

/**
 * Reads a player's key bindings into a normalized {throttle, steer, brake} struct.
 * Same output shape regardless of input source, so Car.update() can consume
 * player input and AI input identically.
 */
export function readInput(keys) {
  const throttle = pressed.has(keys.throttle) ? 1 : 0;
  const brake = pressed.has(keys.brake) ? 1 : 0;
  let steer = 0;
  if (pressed.has(keys.turnLeft)) steer -= 1;
  if (pressed.has(keys.turnRight)) steer += 1;
  const handbrake = pressed.has(keys.handbrake);
  return { throttle, brake, steer, handbrake };
}

export function isKeyDown(code) {
  return pressed.has(code);
}
