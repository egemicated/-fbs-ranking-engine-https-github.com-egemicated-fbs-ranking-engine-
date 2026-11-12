import { calculateDivisionSor } from './scenario-sor.js';
import { calculateScenario } from './cfp-scenario-model.js';

self.addEventListener('message', ({ data }) => {
  const { id, input, picks, customGames } = data;
  try {
    const rows = calculateScenario(input, picks, customGames, calculateDivisionSor);
    self.postMessage({ id, rows });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
});
