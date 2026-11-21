import { describe, expect, it } from 'vitest';
import { periscopeAttack, start } from './attackGame';

describe('"Konvojen"', () => {
  it.each(['crew', 'player'] as const)('sink the freighter, then go deep and slip away (%s)', (who) => {
    const s = start('convoy', who);
    periscopeAttack(s, who, 'lastaren');
    s.send({ kind: 'periscope', up: false });
    s.send({ kind: 'setDepth', depth: 200 });
    s.send({ kind: 'setSpeed', knots: 8 });
    s.send({ kind: 'setHeading', heading: 180 });
    s.run(240);
    s.send({ kind: 'setSpeed', knots: 4 });
    s.send({ kind: 'setHeading', heading: 270 });
    s.run(2500);
    expect(s.runner.status).toBe('completed');
  });

  it('staying above the layer at 8 knots after the attack brings the escort and its depth charges', () => {
    // The escort used to give up on its way to the heard launch (5–6 km off) before it got there.
    const s = start('convoy', 'crew');
    periscopeAttack(s, 'crew', 'lastaren');
    s.send({ kind: 'periscope', up: false });
    s.send({ kind: 'setDepth', depth: 60 });
    s.send({ kind: 'setSpeed', knots: 8 });
    s.run(700, () => s.c.log.some((e) => e.text.startsWith('Sjunkbomber i vattnet från korvetten Eskort')));
    expect(s.c.hunter.state('eskorten')).toBe('attack');
    expect(s.c.log.some((e) => e.text.startsWith('Sjunkbomber i vattnet från korvetten Eskort'))).toBe(true);
  });
});
