import { describe, expect, test } from 'vitest';
import { parseMessageSegments } from './moveMention.js';

describe('parseMessageSegments', () => {
  test('plain prose with no bold or moves passes through as one text segment', () => {
    expect(parseMessageSegments('what did you consider here?')).toEqual([
      { type: 'text', value: 'what did you consider here?', bold: false }
    ]);
  });

  test('renders **bold** spans as bold, not literal asterisks', () => {
    expect(parseMessageSegments('that was **not** ideal')).toEqual([
      { type: 'text', value: 'that was ', bold: false },
      { type: 'text', value: 'not', bold: true },
      { type: 'text', value: ' ideal', bold: false }
    ]);
  });

  test('detects a bare SAN move mention', () => {
    expect(parseMessageSegments('what about b3 here?')).toEqual([
      { type: 'text', value: 'what about ', bold: false },
      { type: 'move', text: 'b3', san: 'b3', bold: false },
      { type: 'text', value: ' here?', bold: false }
    ]);
  });

  test('detects a bold move mention, keeping it bold', () => {
    expect(parseMessageSegments('what about **b3** here?')).toEqual([
      { type: 'text', value: 'what about ', bold: false },
      { type: 'move', text: 'b3', san: 'b3', bold: true },
      { type: 'text', value: ' here?', bold: false }
    ]);
  });

  test('normalizes a move-number-and-period prefix, adding the missing space', () => {
    expect(parseMessageSegments('after 1.e4')).toEqual([
      { type: 'text', value: 'after ', bold: false },
      { type: 'move', text: '1. e4', san: 'e4', bold: false }
    ]);
  });

  test('keeps an explicit ellipsis prefix for a black move stated alone', () => {
    expect(parseMessageSegments('after 18...Nf3')).toEqual([
      { type: 'text', value: 'after ', bold: false },
      { type: 'move', text: '18...Nf3', san: 'Nf3', bold: false }
    ]);
  });

  test('normalizes the coach\'s hyphenated move-number typo to standard notation', () => {
    expect(parseMessageSegments('1-e3 was the idea')).toEqual([
      { type: 'move', text: '1. e3', san: 'e3', bold: false },
      { type: 'text', value: ' was the idea', bold: false }
    ]);
  });

  test('resolves a piece capture and a castle as move mentions', () => {
    expect(parseMessageSegments('Rxd5 O-O')).toEqual([
      { type: 'move', text: 'Rxd5', san: 'Rxd5', bold: false },
      { type: 'text', value: ' ', bold: false },
      { type: 'move', text: 'O-O', san: 'O-O', bold: false }
    ]);
  });

  test('does not treat ordinary prose words as moves', () => {
    expect(parseMessageSegments('a good idea and a bad one')).toEqual([
      { type: 'text', value: 'a good idea and a bad one', bold: false }
    ]);
  });
});
