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

// gameReady must fire only once the UI is interactable — after init has
// loaded the save and built the title screen, and a frame has painted.
void game
  .init()
  .then(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => void platform.ready());
    });
  })
  .catch((err) => platform.reportError('frenzy', err));
