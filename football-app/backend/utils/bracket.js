function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function seedingOrder(size) {
  if (size === 1) return [1];
  const prev = seedingOrder(size / 2);
  const out = [];
  for (const s of prev) {
    out.push(s);
    out.push(size + 1 - s);
  }
  return out;
}

function buildBracketStructure(seeds) {
  const size = nextPowerOfTwo(seeds.length);
  const order = seedingOrder(size);
  const slots = order.map((seedNum) => (seedNum <= seeds.length ? seeds[seedNum - 1] : null));

  const rounds = [];
  let currentRound = [];
  for (let i = 0; i < slots.length; i += 2) {
    currentRound.push({
      bracket_position: i / 2 + 1,
      home_seed: slots[i],
      away_seed: slots[i + 1],
    });
  }
  rounds.push(currentRound);

  let matchesInRound = currentRound.length / 2;
  let round = 2;
  while (matchesInRound >= 1) {
    const r = [];
    for (let i = 0; i < matchesInRound; i += 1) {
      r.push({ bracket_position: i + 1, home_seed: null, away_seed: null });
    }
    rounds.push(r);
    if (matchesInRound === 1) break;
    matchesInRound = matchesInRound / 2;
    round += 1;
  }

  return rounds;
}

function buildSeedsFromConfig(cupConfig, numPools) {
  const placements = cupConfig.source_placements.slice().sort((a, b) => a - b);
  const seeds = [];
  for (const placement of placements) {
    for (let poolIdx = 0; poolIdx < numPools; poolIdx += 1) {
      seeds.push({ pool_index: poolIdx, placement });
    }
  }
  return seeds;
}

module.exports = { buildBracketStructure, buildSeedsFromConfig, nextPowerOfTwo, seedingOrder };
