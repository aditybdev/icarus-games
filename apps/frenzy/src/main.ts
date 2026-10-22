/**
 * Four-Leg Frenzy — entry point. All host access goes through the platform
 * adapter (the Playables SDK may be absent or fail to load).
 */
import { createPlatform, installErrorHooks } from '@icarus/platform';
import { Game } from './game';

const platform = createPlatform('frenzy');

installErrorHooks(platform, 'frenzy');

const game = new Game(platform);

platform.bindLifecycle({
  pause: () => game.pause(),
  resume: () => game.resume(),
  // A host/visibility resume must not dismiss a pause the user chose.
  isManualPause: () => game.isManualPause,
});

game.init().catch((err) => platform.reportError('frenzy', err));

// signal readiness after the first frame has been painted
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void platform.ready();
  });
});
