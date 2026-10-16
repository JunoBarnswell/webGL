import { useSyncExternalStore } from 'react';
import type { SceneRuntime } from '@studio/scene-runtime';
import { emptySnapshot } from '../../scene-runtime/src/RuntimeState';
const designSnapshot=emptySnapshot();
const idleSubscribe=()=>()=>{};
const idleSnapshot=()=>designSnapshot;
export function useRuntime(runtime:SceneRuntime|null){return useSyncExternalStore(runtime?.subscribe??idleSubscribe,runtime?.getSnapshot??idleSnapshot);}
