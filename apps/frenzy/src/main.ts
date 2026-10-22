/**
 * Four-Leg Frenzy — entry point. All host access goes through the platform
 * adapter (the Playables SDK may be absent or fail to load).
 */
import { createPlatform } from '@icarus/platform';
import { Game } from './game';

const platform = createPlatform('frenzy');

window.addEventListener('error', (e) => {
  platform.reportError('frenzy', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  platform.reportError('frenzy', e.reason);
});

const game = new Game(platform);

platform.bindLifecycle({
  pause: () => game.pause(),
  resume: () => game.resume(),
});

game.init().catch((err) => platform.reportError('frenzy', err));

// signal readiness after the first frame has been painted
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void platform.ready();
  });
});
