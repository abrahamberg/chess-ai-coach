import { computePositionFeatures } from '@chess-coach/chess-analysis';
import { ENGINE_DEFAULT_DEPTH } from '@chess-coach/shared';
import { Chess } from 'chess.js';
import { useEffect } from 'react';
import { getSharedEngineWorker } from '../engine/shared-engine-worker-instance.js';
import type { RawEngineLine } from '../engine/shared-engine-worker.js';

// Defensive fallbacks only — apps/api always sends an explicit depth/multiPv
// (services/engine/browser-tunnel-engine-backend.ts). They come from
// @chess-coach/shared rather than being retyped here because this file used to
// hardcode depth 15 against the native backend's 16, and every position the
// browser analyzed went into the fen-keyed cache a ply shallower than the
// server's own rows. See design spec §2.
const DEFAULT_DEPTH = ENGINE_DEFAULT_DEPTH;
const DEFAULT_MULTI_PV = 3;

interface TunnelRequestMessage {
  requestId: string;
  kind: 'analyze-position' | 'analyze-game';
  fen?: string;
  fens?: string[];
  depth?: number;
  multiPv?: number;
}

interface TunnelResponseMessage {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function pvUciToSan(fen: string, pvUci: string[]): string[] {
  const chess = new Chess(fen);
  const sanMoves: string[] = [];
  for (const uciMove of pvUci) {
    const move = chess.move({ from: uciMove.slice(0, 2), to: uciMove.slice(2, 4), promotion: uciMove.slice(4, 5) || undefined });
    if (!move) break;
    sanMoves.push(move.san);
  }
  return sanMoves;
}

// RawEngineLine.cp/mateIn are relative to whichever side is to move in `fen`
// (raw UCI semantics -- see shared-engine-worker.ts and useWasmEngine.ts's
// own sideToMove conversion). Every other EngineEval/PositionAnalysis in the
// system is white-perspective (services/engine/src/uci.ts's recordInfoLine
// does this same conversion for the native backend), so this has to happen
// before a browser-tunnel result is packaged up -- otherwise every
// black-to-move position's cp sign is inverted relative to what
// classify.ts's cpLoss math expects.
function toWhitePerspective(fen: string, value: number | null): number | null {
  if (value === null) return null;
  const sideToMove = fen.split(' ')[1];
  return sideToMove === 'b' ? -value : value;
}

function toPositionAnalysisLine(fen: string, line: RawEngineLine) {
  const pvSan = pvUciToSan(fen, line.pvUci);
  return {
    moveUci: line.moveUci,
    moveSan: pvSan[0] ?? line.moveUci,
    pvSan,
    cp: toWhitePerspective(fen, line.cp),
    mateIn: toWhitePerspective(fen, line.mateIn)
  };
}

async function analyzePositionForTunnel(fen: string, depth: number, multiPv: number) {
  const lines = await getSharedEngineWorker().analyze({ fen, depth, multiPv });
  const positionLines = lines.map((line) => toPositionAnalysisLine(fen, line));
  const best = positionLines[0];
  return {
    fen,
    depth,
    multiPv: positionLines.length,
    bestMove: best?.moveSan ?? null,
    eval: { cp: best?.cp ?? null, mateIn: best?.mateIn ?? null },
    lines: positionLines,
    features: computePositionFeatures(fen)
  };
}

async function analyzeGameForTunnel(fens: string[], depth: number, multiPv: number) {
  const results = [];
  for (const [ply, fen] of fens.entries()) {
    const lines = await getSharedEngineWorker().analyze({ fen, depth, multiPv });
    results.push({
      ply,
      fen,
      depth,
      lines: lines.map((line) => {
        const [moveSan] = pvUciToSan(fen, [line.moveUci]);
        return {
          moveUci: line.moveUci,
          moveSan: moveSan ?? line.moveUci,
          cp: toWhitePerspective(fen, line.cp),
          mateIn: toWhitePerspective(fen, line.mateIn)
        };
      })
    });
  }
  return results;
}

async function handleTunnelRequest(socket: WebSocket, raw: string): Promise<void> {
  const message = JSON.parse(raw) as TunnelRequestMessage;
  try {
    const result =
      message.kind === 'analyze-position'
        ? await analyzePositionForTunnel(message.fen ?? '', message.depth ?? DEFAULT_DEPTH, message.multiPv ?? DEFAULT_MULTI_PV)
        : await analyzeGameForTunnel(message.fens ?? [], message.depth ?? DEFAULT_DEPTH, message.multiPv ?? DEFAULT_MULTI_PV);
    send(socket, { requestId: message.requestId, ok: true, result });
  } catch (error) {
    send(socket, { requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function send(socket: WebSocket, message: TunnelResponseMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// requestId-less, so EngineTunnelRegistry's onmessage handler ("Ignore
// messages without requestId") drops it as a no-op — its only purpose is to
// put traffic on the wire so the connection doesn't look idle.
function sendPing(socket: WebSocket): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
}

function defaultWsUrl(): string {
  return `${window.location.origin.replace(/^http/, 'ws')}/api/engine-tunnel`;
}

// nginx-ingress closes an idle proxied connection after its default 60s
// proxy-read-timeout, and this tunnel can otherwise sit silent for a long
// time between jobs. A ping well under that (the message itself is a no-op —
// EngineTunnelRegistry.registerConnection drops anything without a
// requestId) keeps the connection alive instead of it dying invisibly and
// failing every job with "No tunnel connection" until the tab is reloaded.
const KEEPALIVE_INTERVAL_MS = 20_000;
// A deploy rolling the api pod also closes this socket server-side. Without
// a reconnect, that outage is permanent for the tab's lifetime even though
// the server comes back within seconds.
const RECONNECT_DELAY_MS = 2_000;

export interface UseEngineTunnelClientOptions {
  enabled: boolean;
  wsUrl?: string;
}

/** design spec §5: fulfills the server's browser-mode tunnel requests using
 * the same SharedEngineWorker the Explore panel uses. Mounted once at the
 * app root (App.tsx via useEngineTunnelActivation), not scoped to the
 * session page — background jobs can tunnel a request any time engineMode
 * is 'browser', not just mid-session. Reconnects on any close (idle-timeout
 * or a server redeploy) rather than leaving the tab permanently tunnel-less. */
export function useEngineTunnelClient(options: UseEngineTunnelClientOptions): void {
  useEffect(() => {
    if (!options.enabled) return undefined;

    const wsUrl = options.wsUrl ?? defaultWsUrl();
    let socket: WebSocket | undefined;
    let keepaliveId: ReturnType<typeof setInterval> | undefined;
    let reconnectId: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    function connect(): void {
      socket = new WebSocket(wsUrl);
      socket.onmessage = (event: MessageEvent<string>) => {
        void handleTunnelRequest(socket!, event.data);
      };
      socket.onopen = () => {
        if (stopped) return;
        keepaliveId = setInterval(() => sendPing(socket!), KEEPALIVE_INTERVAL_MS);
      };
      socket.onclose = () => {
        if (keepaliveId !== undefined) clearInterval(keepaliveId);
        if (!stopped) reconnectId = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }
    connect();

    return () => {
      stopped = true;
      if (keepaliveId !== undefined) clearInterval(keepaliveId);
      if (reconnectId !== undefined) clearTimeout(reconnectId);
      socket?.close();
    };
  }, [options.enabled, options.wsUrl]);
}
