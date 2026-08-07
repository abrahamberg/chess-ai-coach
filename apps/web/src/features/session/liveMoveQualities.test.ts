import { describe, expect, test } from 'vitest';
import { toClassifiedMoves } from './liveMoveQualities.js';

describe('toClassifiedMoves', () => {
  test('adapts a live move quality row into ClassifiedMoveDto shape with isUserMove/hangsPiece defaulted', () => {
    const result = toClassifiedMoves([
      { ply: 3, moveSan: 'Nf3', mover: 'white', quality: 'best', cpLoss: 0, bestLineSan: ['Nf3'], evalAfterCp: 20 }
    ]);

    expect(result).toEqual([
      {
        ply: 3,
        moveSan: 'Nf3',
        mover: 'white',
        quality: 'best',
        cpLoss: 0,
        bestLineSan: ['Nf3'],
        evalAfterCp: 20,
        isUserMove: false,
        hangsPiece: false
      }
    ]);
  });

  test('an empty list maps to an empty list', () => {
    expect(toClassifiedMoves([])).toEqual([]);
  });
});
