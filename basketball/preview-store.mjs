import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from '../src/ingest.js';
import { buildBasketballSnapshot } from './model-engine.js';
import { captureBasketballForecasts, reportBasketballForecasts } from './model-ledger.js';
import { withBasketballRefreshLock } from './data-client.js';
import { basketballConferenceQuality } from './conference-quality.mjs';

const read = async file => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if(error.code !== 'ENOENT') throw error; return null; }
};
export async function loadPreviewStore(root, clock = Date.now(), {
  stateDir = join(root, 'research', 'cache', 'basketball', 'preview'),
  capture = true,
} = {}) {
  const sourceDir = join(root, 'data', 'seasons', 'basketball');
  await mkdir(stateDir, { recursive:true });
  const sourceFiles = await readdir(sourceDir).catch(error=>{if(error.code!=='ENOENT') throw error;return [];});
  const seasons = new Map();
  const activeYear = new Date(clock).getUTCFullYear()+Number(new Date(clock).getUTCMonth()>=6);
  const validation = await read(join(root,'reports','full-court-basketball-validation.json'));
  return withBasketballRefreshLock(join(stateDir,'publication.lock'), async () => {
    for(const file of sourceFiles.filter(name=>/^\d{4}\.json$/.test(name)).sort()) {
      const dataset = await read(join(sourceDir,file));
      const year = Number(file.slice(0,4));
      if (dataset?.competition !== 'ncaam-d1' || dataset.season !== year) throw Error(`Unexpected season input for ${year}`);
      const historical = year < activeYear;
      const options = historical ? {asOf:`${year}-07-01T00:00:00.000Z`,retrospective:true} : {};
      const snapshot = buildBasketballSnapshot(dataset, {...options, ...(validation?.modelConfig ? {config:validation.modelConfig} : {})});
      const forecastFile = join(stateDir, `${year}-forecasts.json`);
      const editionFile = join(stateDir, `${year}-editions.json`);
      const ledger = (await read(forecastFile)) ?? [];
      const editions = (await read(editionFile)) ?? [];
      const nextLedger = historical || !capture ? ledger : captureBasketballForecasts(dataset,snapshot,ledger,clock);
      if (nextLedger.length!==ledger.length) await atomicJson(forecastFile,nextLedger,{spacing:0});
      if (capture && !historical && !editions.some(edition=>edition.snapshotHash===snapshot.snapshotHash)) {
        editions.push({ asOf:snapshot.asOf, publishedAt:new Date(clock).toISOString(),gamesUsed:snapshot.gamesUsed,
          modelVersion:snapshot.modelVersion,snapshotHash:snapshot.snapshotHash,
          teams:Object.fromEntries(snapshot.teams.filter(team=>team.sorRank).map(team=>[team.id,team.sorRank])) });
        await atomicJson(editionFile,editions,{spacing:0});
      }
      const report=reportBasketballForecasts(dataset,nextLedger);
      seasons.set(year,{year,dataset,snapshot,conferenceQuality:basketballConferenceQuality({snapshot,dataset}),
        forecastReportById:new Map(report.games.map(game=>[game.gameId,game])),
        forecasts:new Map(nextLedger.map(game=>[game.gameId,game])),editions,report,historical,validation,
        teams:new Map(snapshot.teams.map(team=>[team.id,team])),
        conferences:[...new Set(snapshot.teams.map(team=>team.conference).filter(Boolean))].sort()});
    }
    return {seasons, activeYear, stateDir};
  });
}
