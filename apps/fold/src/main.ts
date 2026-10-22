/**
 * Fold — bootstrap. Creates the platform adapter, starts the game, and
 * wires lifecycle + error reporting.
 */

import { createPlatform } from '@icarus/platform';
import { Game } from './game';

const platform = createPlatform('fold');

window.addEventListener('error', (e) => {
  platform.reportError('fold', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  platform.reportError('fold', e.reason);
});

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
