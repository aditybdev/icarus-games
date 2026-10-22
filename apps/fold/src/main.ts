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

void game.init().catch((err) => platform.reportError('fold', err));

// Signal readiness to the host after the first frame has been rendered.
requestAnimationFrame(() => {
  void platform.ready();
});
