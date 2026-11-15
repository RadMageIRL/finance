// How Money Flows: the simulator with the flow view and the whole transaction catalog.

import { ENTITIES, ENTITY_INFO, type EntityId } from '../../lib/engines/ledger/model';
import { flowSvg, flowView } from '../../lib/learn/flow-view';
import { FLOW_CATALOG, FLOW_ENTITIES, FLOW_OPENING_TEXT, FLOW_STEPS, flowCounterRows, flowsOpening } from '../../lib/learn/flows';
import { LESSON_CAPITAL_RATIO } from '../../lib/learn/banks';
import { wireSimulator } from './simulator';

const root = document.querySelector<HTMLElement>('[data-sim-lesson="flows"]');
const names = Object.fromEntries(ENTITIES.map((e) => [e, ENTITY_INFO[e].name])) as Record<EntityId, string>;

if (root) {
  // Flow view, balance sheets or both.
  root.querySelectorAll<HTMLInputElement>('input[name="mf-view"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      root.dataset.view = radio.value;
    }),
  );
  wireSimulator(root, {
    entities: FLOW_ENTITIES,
    opening: flowsOpening,
    openingText: FLOW_OPENING_TEXT,
    steps: FLOW_STEPS,
    counters: flowCounterRows,
    free: FLOW_CATALOG,
    capitalRatio: LESSON_CAPITAL_RATIO,
    flow: { view: flowView, svg: (v) => flowSvg(v, names, 'mf-flow') },
  });
}
