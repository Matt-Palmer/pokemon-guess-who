import { MatchEvent, MatchState } from './types';

export function reduce(state: MatchState, event: MatchEvent): MatchState {
  switch (event.type) {
    case 'DRAW_SECRET':
    case 'ASK':
    case 'ANSWER':
    case 'GUESS':
    case 'CROSS_OFF':
    case 'RESIGN':
    case 'CLAIM_INACTIVE':
      throw new Error(`${event.type} not implemented yet`);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
