import { computePositionFeatures } from '@chess-coach/chess-analysis';
import { Chess } from 'chess.js';
import { useEffect } from 'react';
import { getSharedEngineWorker } from '../engine/shared-engine-worker-instance.js';
import type { RawEngineLine } from '../engine/shared-engine-worker.js';

const DEFAULT_DEPTH = 15;
// Must match apps/api's ENGINE_MULTI_PV (services/engine-client.ts) — see
// design spec §2: both backends analyze at the same default depth/multiPv
// so cached rows stay comparable across sources.
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

function toPositionAnalysisLine(fen: string, line: RawEngineLine) {
  const pvSan = pvUciToSan(fen, line.pvUci);
  return { moveUci: line.moveUci, moveSan: pvSan[0] ?? line.moveUci, pvSan, cp: line.cp, mateIn: line.mateIn };
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

async function analyzeGameForTunnel(fens: string[], depth: number) {
  const results = [];
  for (const [ply, fen] of fens.entries()) {
    const lines = await getSharedEngineWorker().analyze({ fen, depth, multiPv: 1 });
    results.push({
      ply,
      fen,
      depth,
      lines: lines.map((line) => {
        const [moveSan] = pvUciToSan(fen, [line.moveUci]);
        return { moveUci: line.moveUci, moveSan: moveSan ?? line.moveUci, cp: line.cp, mateIn: line.mateIn };
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
        : await analyzeGameForTunnel(message.fens ?? [], message.depth ?? DEFAULT_DEPTH);
    send(socket, { requestId: message.requestId, ok: true, result });
  } catch (error) {
    send(socket, { requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function send(socket: WebSocket, message: TunnelResponseMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function defaultWsUrl(): string {
  return `${window.location.origin.replace(/^http/, 'ws')}/api/engine-tunnel`;
}

export interface UseEngineTunnelClientOptions {
  enabled: boolean;
  wsUrl?: string;
}

/** design spec §5: fulfills the server's browser-mode tunnel requests using
 * the same SharedEngineWorker the Explore panel uses. Mounted once at the
 * app root (App.tsx via useEngineTunnelActivation), not scoped to the
 * session page — background jobs can tunnel a request any time engineMode
 * is 'browser', not just mid-session. */
export function useEngineTunnelClient(options: UseEngineTunnelClientOptions): void {
  useEffect(() => {
    if (!options.enabled) return undefined;

    const socket = new WebSocket(options.wsUrl ?? defaultWsUrl());
    socket.onmessage = (event: MessageEvent<string>) => {
      void handleTunnelRequest(socket, event.data);
    };

    return () => socket.close();
  }, [options.enabled, options.wsUrl]);
}
