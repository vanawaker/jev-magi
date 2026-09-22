export const UNIT_IDS = ['melchior', 'balthasar', 'casper'] as const;
export type UnitId = typeof UNIT_IDS[number];
export const UNITS = {
  melchior: { name: 'MELCHIOR', number: '01', dimension: '理性', description: '合理，且可行嗎？', identity: 'THE SCIENTIST' },
  balthasar: { name: 'BALTHASAR', number: '02', dimension: '守護', description: '對人和未來有益嗎？', identity: 'THE GUARDIAN' },
  casper: { name: 'CASPER', number: '03', dimension: '自我', description: '這是你想要的嗎？', identity: 'THE INDIVIDUAL' },
} as const;
export type Verdict = { votes: Record<UnitId, boolean>; approved: boolean };
// Input that a single yes or no cannot answer gets no vote at all.
export type Outcome = Verdict | { invalid: true };
export function decide(votes: Record<UnitId, boolean>): Verdict {
  return { votes, approved: UNIT_IDS.filter(id => votes[id]).length >= 2 };
}
