// How Money Flows: the flow view. Who paid whom in a transaction, drawn as arrows between
// the sectors, with a text title that says the same for screen readers. Pure; the arrows
// are read from the transaction's own postings.

import type { Transaction } from '../engines/ledger/ledger';
import { ENTITIES, type EntityId } from '../engines/ledger/model';
import { FLOW_LAYOUT } from './flows';

export interface FlowArrow {
  from: EntityId;
  to: EntityId;
  label: string;
}

export interface FlowView {
  changed: Set<EntityId>;
  arrows: FlowArrow[];
}

const MONEY_LIKE = new Set<string>(['deposit', 'currency', 'tga']);
const LENDING = new Set<string>(['loan', 'discount-loan', 'interbank-loan', 'reverse-repo']);

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Arrows for a transaction: money (deposits, cash, the Treasury's account) from payer to
 * payee; reserves between banks, or from and to the Fed; securities from seller to buyer,
 * or new from the Treasury; and loans from lender to borrower.
 */
export function flowView(tx: Transaction | null): FlowView {
  const changed = new Set<EntityId>();
  const arrows: FlowArrow[] = [];
  if (!tx) return { changed, arrows };
  for (const c of tx.claims) {
    changed.add(c.holder);
    changed.add(c.issuer);
  }
  for (const e of tx.equity) changed.add(e.entity);

  const pair = (match: (instrument: string) => boolean, verb: string, alone: EntityId | null, aloneVerb: (up: boolean) => string) => {
    const down = tx.claims.filter((c) => match(c.instrument) && c.change < 0).map((c) => ({ who: c.holder, amount: -c.change }));
    const up = tx.claims.filter((c) => match(c.instrument) && c.change > 0).map((c) => ({ who: c.holder, amount: c.change }));
    for (const d of [...down]) {
      const k = up.findIndex((u) => u.amount === d.amount && u.who !== d.who);
      if (k < 0) continue;
      arrows.push({ from: d.who, to: up[k]!.who, label: `${verb} ${money(d.amount)}` });
      up.splice(k, 1);
      down.splice(down.indexOf(d), 1);
    }
    if (!alone) return;
    for (const u of up) if (u.who !== alone) arrows.push({ from: alone, to: u.who, label: `${aloneVerb(true)} ${money(u.amount)}` });
    for (const d of down) if (d.who !== alone) arrows.push({ from: d.who, to: alone, label: `${aloneVerb(false)} ${money(d.amount)}` });
  };
  pair((i) => MONEY_LIKE.has(i), 'pays', null, () => '');
  pair((i) => i === 'reserves' || i === 'vault-cash', 'reserves', 'Fed', (up) => (up ? 'new reserves' : 'reserves to the Fed'));
  pair((i) => i === 'security', 'security', 'Treasury', (up) => (up ? 'new security' : 'security redeemed'));
  for (const c of tx.claims) {
    if (!LENDING.has(c.instrument)) continue;
    // A write-off is not a repayment: nothing moves from the borrower. In this model the
    // bank gives up its claim (the loss goes to its equity and the borrower's equity rises).
    if (tx.kind === 'write-off') {
      arrows.push({ from: c.holder, to: c.issuer, label: `writes off ${money(-c.change)}` });
      continue;
    }
    arrows.push(c.change > 0 ? { from: c.holder, to: c.issuer, label: `lends ${money(c.change)}` } : { from: c.issuer, to: c.holder, label: `repays ${money(-c.change)}` });
  }
  return { changed, arrows };
}

const NODE_W = 150;
const NODE_H = 46;
const COL_X = [20, 245, 470] as const;
const ROW_Y = [20, 130, 240] as const;
const escXml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The sector map with a transaction's arrows, as an SVG string (fixed labels and numbers only). */
export function flowSvg(view: FlowView, names: Readonly<Record<EntityId, string>>, idPrefix = 'flow'): string {
  const box = (e: EntityId) => ({ x: COL_X[FLOW_LAYOUT[e].col as 0 | 1 | 2], y: ROW_Y[FLOW_LAYOUT[e].row as 0 | 1 | 2] });
  const center = (e: EntityId) => ({ x: box(e).x + NODE_W / 2, y: box(e).y + NODE_H / 2 });
  const summary = view.arrows.length ? `Flows: ${view.arrows.map((a) => `${names[a.from]} to ${names[a.to]}, ${a.label}`).join('; ')}` : 'No flows in this step';
  const parts = [
    `<svg class="flow" viewBox="0 0 640 306" role="img" aria-labelledby="${idPrefix}-title"><title id="${idPrefix}-title">${escXml(summary)}</title>`,
    `<defs><marker id="${idPrefix}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="flow__head" d="M0,0L10,5L0,10z"/></marker></defs>`,
  ];
  for (const e of ENTITIES) {
    const { x, y } = box(e);
    const on = view.changed.has(e);
    parts.push(
      `<g class="flow__node${on ? ' is-changed' : ''}"><rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="8"/>` +
        `<text x="${x + NODE_W / 2}" y="${y + 20}" text-anchor="middle" class="flow__name">${escXml(names[e])}</text>` +
        `<text x="${x + NODE_W / 2}" y="${y + 36}" text-anchor="middle" class="flow__group">${escXml(on ? `${FLOW_LAYOUT[e].group}: changed` : FLOW_LAYOUT[e].group)}</text></g>`,
    );
  }
  const seen = new Map<string, number>();
  for (const a of view.arrows) {
    const p = center(a.from);
    const q = center(a.to);
    const key = [a.from, a.to].sort().join('|');
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    // A second arrow between the same two sectors runs alongside the first.
    const off = n * 16;
    const ox = (-dy / len) * off;
    const oy = (dx / len) * off;
    const at = (t: number) => ({ x: p.x + dx * t + ox, y: p.y + dy * t + oy });
    const edge = Math.min(0.45, (NODE_W / 2 + 6) / Math.max(Math.abs(dx), 1), (NODE_H / 2 + 6) / Math.max(Math.abs(dy), 1));
    const s = at(edge);
    const t = at(1 - edge);
    const m = at(0.5);
    parts.push(`<line class="flow__arrow" x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t.x.toFixed(1)}" y2="${t.y.toFixed(1)}" marker-end="url(#${idPrefix}-arrow)"/>`);
    parts.push(`<text class="flow__label" x="${m.x.toFixed(1)}" y="${(m.y - 6).toFixed(1)}" text-anchor="middle">${escXml(a.label)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
