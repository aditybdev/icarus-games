/**
 * Fold — bootstrap. Creates the platform adapter, starts the game, and
 * wires lifecycle + error reporting.
 */

import { createPlatform, installErrorHooks } from '@icarus/platform';
import { Game } from './game';

const platform = createPlatform('fold');

installErrorHooks(platform, 'fold');

const game = new Game(platform);

platform.bindLifecycle({
  pause: () => game.setPaused(true),
  resume: () => game.setPaused(false),
});

// gameReady must fire only once the UI is interactable — after init has
// loaded the save and built the title screen, and a frame has painted.
void game
  .init()
  .then(() => {
    requestAnimationFrame(() => void platform.ready());
  })
  .catch((err) => platform.reportError('fold', err));
