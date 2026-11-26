import { ChessVariant, Move } from '../types/chess';
import { parseFen } from './chessEngine';
import {
  analyzeGameMoves,
  analyzePositionMultiPv,
  EngineLine,
  findThreatLine,
} from './aiSearch';

export type AnalysisWorkerRequest =
  | {
      id: number;
      type: 'multiPv';
      fen: string;
      variant: ChessVariant;
      depth: number;
      numLines: number;
      includeThreat: boolean;
    }
  | {
      id: number;
      type: 'gameReview';
      fens: string[];
      moves: Move[];
      variant: ChessVariant;
    };

export type AnalysisWorkerResponse =
  | {
      id: number;
      type: 'multiPvResult';
      lines: EngineLine[];
      threat: EngineLine | null;
    }
  | {
      id: number;
      type: 'reviewProgress';
      done: number;
      total: number;
    }
  | {
      id: number;
      type: 'reviewResult';
      analyzed: ReturnType<typeof analyzeGameMoves>['analyzed'];
      accuracy: ReturnType<typeof analyzeGameMoves>['accuracy'];
      acpl: ReturnType<typeof analyzeGameMoves>['acpl'];
      extractedPuzzles: ReturnType<typeof analyzeGameMoves>['extractedPuzzles'];
    };

const MAX_CACHE_ENTRIES = 400;
const positionCache = new Map<string, { lines: EngineLine[]; threat: EngineLine | null }>();

function setCache(key: string, value: { lines: EngineLine[]; threat: EngineLine | null }) {
  if (positionCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = positionCache.keys().next().value;
    if (firstKey !== undefined) {
      positionCache.delete(firstKey);
    }
  }
  positionCache.set(key, value);
}

self.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'multiPv') {
    const cacheKey = `${msg.fen}|${msg.variant}|${msg.depth}|${msg.numLines}|${msg.includeThreat ? 1 : 0}`;
    const cached = positionCache.get(cacheKey);
    if (cached) {
      const response: AnalysisWorkerResponse = {
        id: msg.id,
        type: 'multiPvResult',
        lines: cached.lines,
        threat: cached.threat,
      };
      self.postMessage(response);
      return;
    }

    const state = parseFen(msg.fen, msg.variant);
    const lines = analyzePositionMultiPv(state, msg.numLines, msg.depth);
    const threat = msg.includeThreat ? findThreatLine(state, msg.depth) : null;
    setCache(cacheKey, { lines, threat });

    const response: AnalysisWorkerResponse = {
      id: msg.id,
      type: 'multiPvResult',
      lines,
      threat,
    };
    self.postMessage(response);
    return;
  }

  if (msg.type === 'gameReview') {
    const result = analyzeGameMoves(msg.fens, msg.moves, msg.variant, (done, total) => {
      const progressMsg: AnalysisWorkerResponse = {
        id: msg.id,
        type: 'reviewProgress',
        done,
        total,
      };
      self.postMessage(progressMsg);
    });

    const response: AnalysisWorkerResponse = {
      id: msg.id,
      type: 'reviewResult',
      analyzed: result.analyzed,
      accuracy: result.accuracy,
      acpl: result.acpl,
      extractedPuzzles: result.extractedPuzzles,
    };
    self.postMessage(response);
  }
};
