import { calculateDivisionSor } from './scenario-sor.js';
import { compareRootingOutcome, topRootingRecommendations } from './rooting-guide-model.js';

self.addEventListener('message', ({ data }) => {
  const { input, teamId, candidates, champions } = data;
  try {
    const checked = [];
    for (const candidate of candidates) {
      checked.push(compareRootingOutcome(input, teamId, candidate, champions, calculateDivisionSor));
      self.postMessage({ results: topRootingRecommendations(checked), checked: checked.length,
        complete: checked.length === candidates.length });
    }
  } catch {
    self.postMessage({ error: true });
  }
});
