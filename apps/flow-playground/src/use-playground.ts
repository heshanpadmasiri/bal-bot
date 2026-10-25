import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Compiler } from '@bal-bot/compiler';
import type { Demo } from './demo-link';
import { PlaygroundController } from './playground-controller';

export function usePlayground(compiler: Compiler, initial: Demo) {
  const [controller] = useState(() => new PlaygroundController(compiler, initial));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  return {...snapshot, setSource: controller.setSource, selectFunction: controller.selectFunction,
    toggleExpansion: controller.toggleExpansion};
}
