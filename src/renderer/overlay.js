'use strict';

const dot = document.getElementById('dot');
const time = document.getElementById('time');
const tag = document.getElementById('tag');

window.overlayApi.onUpdate(({ elapsed, state }) => {
  time.textContent = elapsed;
  const paused = state === 'paused';
  dot.classList.toggle('paused', paused);
  tag.textContent = paused ? 'PAUSED' : 'REC';
});
