/**
 * Throwing him at each other.
 *
 * Sends and receives the event messages, and turns what arrives into the three
 * things the component actually renders: an arrival, a high five, a tickle.
 *
 * Nothing here waits for an acknowledgement. A throw is fire-and-forget, which
 * is why the sender always gets him back after a beat whether or not anyone was
 * there — a robot who is permanently missing because a packet dropped is the
 * one failure mode that would make this feel broken rather than whimsical.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../data/store';
import {
  isFresh,
  messageId,
  simultaneous,
  TICKLE_SPEAK_MS,
  type Edge,
  type VikMessage,
  type VikMessageBody,
} from '../../lib/companionLink';
import type { Move } from '../../lib/companionGames/rps';
import { companionChannel } from './companionChannel';

export interface Arrival {
  key: number;
  edge: Edge;
  frac: number;
  note?: string;
  from: string;
  /** He arrived carrying tag: you are it until you throw him back. */
  tag?: boolean;
}

export interface LinkEvents {
  /** He just landed on your screen. */
  onArrive: (a: Arrival) => void;
  /** Both of you poked at once. */
  onHighFive: () => void;
  /** They poked theirs. `speak` is false once the line has been said recently. */
  onTickle: (speak: boolean) => void;
  /** A throw arrived while you were unreachable — it goes in the mailbox. */
  onMail: (a: Arrival) => void;
  /** They want a game of rock paper scissors. */
  onRpsInvite: () => void;
  onRpsDecline: () => void;
  /** Their move for a round. */
  onRpsMove: (round: number, move: Move) => void;
  /** Can he be delivered right now, or should it wait in the mailbox. */
  reachable: () => boolean;
}

export interface VikLink {
  /** Send him abroad. `tag` passes it on if you were the one who was it. */
  throwHim: (edge: Edge, frac: number, speed: number, note?: string, tag?: boolean) => void;
  /** Tell them you poked yours. */
  pokedMine: () => void;
  inviteRps: () => void;
  declineRps: () => void;
  sendMove: (round: number, move: Move) => void;
}

export function useVikLink(events: LinkEvents): VikLink {
  const store = useStore();
  const [, setTick] = useState(0);

  // Handlers change identity every render; the channel subscription must not.
  const ref = useRef(events);
  ref.current = events;

  const myLastPokeRef = useRef<number | null>(null);
  const theirLastPokeRef = useRef<number | null>(null);
  const lastSpokeRef = useRef<Record<string, number>>({});

  /**
   * A high five has to be checked on both events, not just on arrival.
   * Checking only when a message lands means whoever pokes *second* never
   * re-evaluates — their side already handled the other's poke as a tickle —
   * and the moment fires on one screen only. Which is worse than not having it.
   */
  const checkHighFive = useCallback((now: number) => {
    const mine = myLastPokeRef.current;
    const theirs = theirLastPokeRef.current;
    if (mine == null || theirs == null) return false;
    if (!simultaneous(mine, theirs, now)) return false;
    // Spent: one high five per pair of pokes, on each screen, exactly once.
    myLastPokeRef.current = null;
    theirLastPokeRef.current = null;
    return true;
  }, []);

  useEffect(() => {
    const channel = companionChannel(store.adapter.kind, store.meId);
    return channel.onMessage((msg: VikMessage) => {
      const now = Date.now();
      // Dedupe by id happens in the channel; freshness is ours.
      if (!isFresh(msg, now)) return;
      const e = ref.current;

      if (msg.k === 'poke') {
        theirLastPokeRef.current = msg.at;
        if (checkHighFive(now)) {
          e.onHighFive();
          return;
        }
        // A fidget should not narrate itself on the other screen every time.
        const last = lastSpokeRef.current[msg.from] ?? 0;
        const speak = now - last >= TICKLE_SPEAK_MS;
        if (speak) lastSpokeRef.current[msg.from] = now;
        e.onTickle(speak);
        return;
      }

      if (msg.k === 'rps-invite') return e.onRpsInvite();
      if (msg.k === 'rps-decline') return e.onRpsDecline();
      if (msg.k === 'rps') return e.onRpsMove(msg.round, msg.move);

      const arrival: Arrival = {
        key: now,
        edge: msg.edge,
        frac: msg.frac,
        note: msg.note,
        from: msg.from,
        tag: msg.tag,
      };
      // Asleep, or heads-down in a block: he waits in the mailbox rather than
      // tumbling onto the screen at three in the morning.
      if (e.reachable()) e.onArrive(arrival);
      else e.onMail(arrival);
      setTick((n) => n + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const send = useCallback(
    (body: VikMessageBody) => {
      const at = Date.now();
      companionChannel(store.adapter.kind, store.meId).send({
        id: messageId(store.meId, at, Math.random()),
        from: store.meId,
        at,
        ...body,
      } as VikMessage);
    },
    [store],
  );

  const throwHim = useCallback(
    (edge: Edge, frac: number, speed: number, note?: string, tag?: boolean) => {
      send({ k: 'throw', edge, frac, speed, note, tag });
    },
    [send],
  );

  const inviteRps = useCallback(() => send({ k: 'rps-invite' }), [send]);
  const declineRps = useCallback(() => send({ k: 'rps-decline' }), [send]);
  const sendMove = useCallback(
    (round: number, move: Move) => send({ k: 'rps', round, move }),
    [send],
  );

  const pokedMine = useCallback(() => {
    const at = Date.now();
    myLastPokeRef.current = at;
    companionChannel(store.adapter.kind, store.meId).send({
      id: messageId(store.meId, at, Math.random()),
      from: store.meId,
      at,
      k: 'poke',
    });
    // They may already have poked a moment ago — this is the other half of the
    // check, so the side that pokes second sees it too.
    if (checkHighFive(at)) ref.current.onHighFive();
  }, [checkHighFive, store]);

  return { throwHim, pokedMine, inviteRps, declineRps, sendMove };
}
