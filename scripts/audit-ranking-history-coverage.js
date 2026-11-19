import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildConferenceDataset, loadConferencePublications } from '../src/conference-publication.js';
import { conferenceFilterCoverage, conferenceRecords, conferenceSummary } from '../frontend/conference-metrics.js';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>JSON.parse(await readFile(path,'utf8'));

export async function auditRankingHistoryCoverage({root=process.cwd()}={}) {
  const [snapshot,fbsPicks,performance,history,recovery]=await Promise.all([
    'published/latest.json','published/weekly-picks.json','published/performance-latest.json',
    'frontend/ranking-history.json','reports/sor-publication-recovery-2026-11-19.json',
  ].map(path=>read(`${root}/${path}`)));
  const {datasets}=await loadConferencePublications({root,snapshot,fbsPicks,performance});
  const rankingEditions=await read(`${root}/frontend/ranking-editions.json`);
  const legacyCurrent=buildConferenceDataset({snapshot,fbsPicks,performance,rankingEditions,rankingHistory:{...history,publications:undefined}});
  const current=datasets.find(data=>data.season===snapshot.season);
  const conferenceQuality={};
  for(const conference of current.conferences){
    const before=conferenceSummary(legacyCurrent,conference.id),after=conferenceSummary(current,conference.id);
    for(const field of ['wins','losses','ties','games','experimentalScore','averageOpponentPredictiveRating','averageWinQuality','averageLossQuality'])
      assert.deepEqual(after[field],before[field],`conference quality/results unchanged: ${conference.id} ${field}`);
    conferenceQuality[conference.id]={experimentalScore:after.experimentalScore,games:after.games,unchanged:true};
  }
  const seasons=datasets.map(data=>{
    const methods=Object.fromEntries(['sor','predictive','performance','ap','cfp'].map(method=>[method,conferenceFilterCoverage(data,{method})]));
    for(const count of Object.values(methods))assert.equal(count.games,count.pregame+count.beforeArchive+count.noPollYet+count.missing+count.publicationTimeUncertain+count.notApplicable);
    for(const game of data.games)for(const evidence of Object.values(game.pregameEdition??{}))
      assert.ok(Date.parse(evidence.availableBefore)<Date.parse(game.startDate),'no later evidence enters a pregame field');
    const matrix=conferenceRecords(data).matrix;
    const directionalGames=Object.values(matrix).flatMap(row=>Object.values(row)).reduce((sum,row)=>sum+row.games,0);
    assert.equal(directionalGames,data.coverage.fbsInterconferenceGames*2);
    const coveredSorGames=data.games.filter(game=>game.pregameEdition?.sor).map(game=>({id:game.id,kickoff:game.startDate,
      snapshotAsOf:game.pregameAsOf.sor,...game.pregameEdition.sor}));
    return {season:data.season,archived:data.archived,resultsThrough:data.resultsThrough,eligibleGames:data.coverage,methods,
      coveredSorGames,predictiveBasis:data.rankings.predictive.basis,reciprocalMatrixReconciled:true};
  });
  const protectedHashes={};
  for(const [path,expected]of Object.entries(recovery.protectedHashes)){
    protectedHashes[path]=sha256(await readFile(`${root}/${path}`));
    assert.equal(protectedHashes[path],expected,`protected model/publication unchanged: ${path}`);
  }
  const csv=await readFile(`${root}/research/results/historical-foundation-v1/season-coverage.csv`,'utf8');
  const [header,...lines]=csv.trim().split(/\r?\n/).map(row=>row.split(','));
  const historicalSeasons=lines.map(values=>Object.fromEntries(header.map((name,index)=>[name,values[index]==='unknown'?'unknown':Number(values[index])])));
  const report={schemaVersion:1,checkedAt:new Date().toISOString(),snapshotHash:snapshot.snapshotHash,sourceCutoff:snapshot.source.fetchedAt,
    savedWeeklyEditions:history.editions.filter(row=>row.kind==='saved').length,replayEditions:history.editions.filter(row=>row.kind==='replay').length,
    retainedSorPublications:history.publications.length,firstRetainedSorRecord:history.publications[0].recordedAt,
    recordProvenance:'Repository-recorded snapshots; conservative end-of-Mountain-day availability, not website deployment instants',
    seasons,conferenceQuality,historicalCoverage:{status:'Partial in every research season; exact all-season missing totals unknown',
      source:'research/results/historical-foundation-v1/season-coverage.csv',sourceSha256:sha256(csv),seasons:historicalSeasons},
    protectedHashes,productionMathChanged:false,cfbdCalls:0,passed:true};
  return report;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const report=await auditRankingHistoryCoverage();
  await writeFile('reports/ranking-history-coverage-2026-11-19.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,retainedSorPublications:report.retainedSorPublications,
    seasons:report.seasons.map(row=>({season:row.season,methods:row.methods}))},null,2));
}
