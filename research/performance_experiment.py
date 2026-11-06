"""Declared, offline chronological calibration for the first net-YPP prototype.

Raw boxes stay in ignored/private caches. Published research is derived scores,
coverage and fingerprints, never a new raw data mirror or a live ranking change.
"""
import csv
import hashlib
import json
from pathlib import Path

import numpy as np

from performance_model import fit_performance
from replay_weekly import weekly_groups,timestamp,protected_hashes

HERE=Path(__file__).resolve().parent
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def observations(games):
    rows=[]
    for g in games:
        for side,other,sign in (("home","away",1),("away","home",-1)):
            s=g["stats"][side]
            rows.append(dict(gameId=g["id"],teamId=g[side],opponentId=g[other],yards=s["yards"],plays=s["plays"],venue=0 if g["neutral"] else sign))
    return rows


def preweek_features(data,parent,ridge):
    by_game={g["id"]:g for g in data["games"]};seen=set();rows=[]
    divisions={t["id"]:t["division"] for t in data["teams"]}
    for (kind,week),targets in weekly_groups(parent):
        cutoff=min(timestamp(g["startDate"]) for g in targets)
        past=[g for g in data["games"] if g["id"] in seen and timestamp(g["startDate"])+86400<=cutoff]
        assert not {g["id"] for g in targets}&{g["id"] for g in past}
        zero=fit_performance(data["teams"],observations(past),dict(ridge=ridge,homeYpp=0.))
        one=fit_performance(data["teams"],observations(past),dict(ridge=ridge,homeYpp=1.))
        z={t["id"]:t for t in zero["ratings"]};o={t["id"]:t for t in one["ratings"]}
        for target in targets:
            if target["id"] not in by_game:continue
            g=by_game[target["id"]];a,b=g["home"],g["away"]
            if "fbs" not in (divisions[a],divisions[b]):continue
            y=g["stats"]["home"]["yardsPerPlay"]-g["stats"]["away"]["yardsPerPlay"]
            venue=0 if g["neutral"] else 1;neutral=z[a]["rating"]-z[b]["rating"]
            response=venue+(o[a]["rating"]-z[a]["rating"])-(o[b]["rating"]-z[b]["rating"])
            rows.append(dict(id=g["id"],year=data["year"],block=f'{data["year"]}:{kind}:{week}',target=y,neutralPrediction=neutral,homeResponse=response,venue=venue,
                naiveDifference=(z[a]["meanGameNetYpp"] or 0)-(z[b]["meanGameNetYpp"] or 0),
                group="FBS-FBS" if divisions[a]==divisions[b]=="fbs" else "FBS-FCS",early=min(z[a]["measuredGames"],z[b]["measuredGames"])<4))
        seen.update(g["id"] for g in targets)
    return rows


def metrics(rows,home,home_only):
    if not rows:return dict(games=0)
    y=np.array([r["target"] for r in rows]);neutral=np.array([r["neutralPrediction"] for r in rows]);response=np.array([r["homeResponse"] for r in rows]);venue=np.array([r["venue"] for r in rows])
    predictions={"opponentAdjusted":neutral+home*response,"zeroBaseline":np.zeros(len(rows)),"homeOnly":home_only*venue,"unadjustedRateDifference":np.array([r["naiveDifference"] for r in rows])+home_only*venue}
    return dict(games=len(rows),models={name:dict(mse=float(np.mean((p-y)**2)),rmse=float(np.sqrt(np.mean((p-y)**2))),mae=float(np.mean(np.abs(p-y))),meanResidual=float(np.mean(p-y))) for name,p in predictions.items()})


def main():
    protocol_bytes=(HERE/"performance-standard.json").read_bytes();protocol=json.loads(protocol_bytes)
    design=protocol["initialExecutablePrototype"]["settingsSelectionProposal"]
    old=design["homeTrainingYears"];validation=design["ridgeSelectionYears"];later=design["laterEvaluationYears"];years=old+validation+later
    before=protected_hashes();datasets={};parents={};inputs={};parent_hashes={}
    for year in years+[2026]:
        path=HERE/f"datasets/performance-box-v1/seasons/{year}.json";raw=path.read_bytes();datasets[year]=json.loads(raw);inputs[str(year)]=sha(raw)
        if year!=2026:
            parent_raw=(HERE/f"datasets/fcs-coverage-v1/seasons/{year}.json").read_bytes()
            parents[year]=json.loads(parent_raw);parent_hashes[str(year)]=sha(parent_raw)
    implementation={p:sha((HERE/p).read_bytes()) for p in ("performance_model.py","performance_ingest.py","performance_experiment.py","replay_weekly.py","compare_merit.py")}
    fingerprint=sha(protocol_bytes+json.dumps(dict(inputs=inputs,parentOutcomes=parent_hashes,code=implementation),sort_keys=True).encode())
    cache=HERE/"cache/performance/features";cache.mkdir(parents=True,exist_ok=True);grid=[];saved={}
    for ridge in design["ridgeGrid"]:
        features={}
        for year in years:
            key=sha((inputs[str(year)]+parent_hashes[str(year)]+json.dumps(implementation,sort_keys=True)+str(ridge)).encode());path=cache/f'{year}-{key}.json'
            if path.exists():rows=json.loads(path.read_bytes())
            else:
                rows=preweek_features(datasets[year],parents[year],ridge);path.write_bytes(json.dumps(rows,separators=(',',':')).encode())
            features[year]=rows
        train=[r for y in old for r in features[y] if r["group"]=="FBS-FBS"]
        home=sum(r["homeResponse"]*(r["target"]-r["neutralPrediction"]) for r in train)/sum(r["homeResponse"]**2 for r in train)
        home_only=sum(r["venue"]*r["target"] for r in train)/sum(r["venue"]**2 for r in train)
        val=[r for y in validation for r in features[y] if r["group"]=="FBS-FBS"]
        item=dict(ridge=ridge,homeYpp=home,homeOnlyYpp=home_only,trainingGames=len(train),validation=metrics(val,home,home_only));grid.append(item);saved[ridge]=features
        print('Candidate',ridge,'homeYpp',home,'validationMSE',item['validation']['models']['opponentAdjusted']['mse'],flush=True)
    selected=min(grid,key=lambda r:(r['validation']['models']['opponentAdjusted']['mse'],r['ridge']))
    features=saved[selected['ridge']];home=selected['homeYpp'];home_only=selected['homeOnlyYpp'];evaluation={}
    for label,wanted in (("FBS-FBS",lambda r:r['group']=='FBS-FBS'),("FBS-FCS",lambda r:r['group']=='FBS-FCS'),("establishedFbsFbs",lambda r:r['group']=='FBS-FBS' and not r['early'])):
        evaluation[label]=dict(pooled=metrics([r for y in later for r in features[y] if wanted(r)],home,home_only),byYear={str(y):metrics([r for r in features[y] if wanted(r)],home,home_only) for y in later})
    current=fit_performance(datasets[2026]['teams'],observations(datasets[2026]['games']),dict(ridge=selected['ridge'],homeYpp=home))
    assert before==protected_hashes(),'Production changed during offline performance research'
    report=dict(protocol=protocol,runFingerprint=fingerprint,inputSha256=inputs,parentOutcomeSha256=parent_hashes,implementationSha256=implementation,numpyVersion=np.__version__,candidates=grid,selected=selected,evaluation=evaluation,
        current=current,currentCoverage=datasets[2026]['audit'],currentSource=datasets[2026]['source'],currentOutcomeReference=datasets[2026]['outcomeReference'],cfbdCalls=0,productionUnchanged=True,
        limits=['A yards/play proxy, not a complete performance or predictive replacement. No special-teams/field-position/EPA/garbage-time/OT adjustment is claimed.',
          'Source boxes and eligibility coverage vary; missing statistics are never zero-filled.',
          'Corrected retrospective data and previously inspected seasons; no genuinely prospective superiority claim.',
          'FBS-FBS settings selection does not certify FBS-FCS calibration. Sparse FCS context remains material.',
          'The current illustration uses only matched games in the saved source snapshot; current-source data may lag the SOR game set.',
          'Raw offense/defense numbers are diagnostics, not separately adjusted unit grades. No hidden blend with SOR or predictive strength.'])
    output=HERE/"results/performance"/fingerprint[:12];output.mkdir(parents=True,exist_ok=True)
    (output/'experiment.json').write_bytes((json.dumps(report,indent=2)+'\n').encode())
    with (output/'current-ratings.csv').open('w',newline='',encoding='utf-8') as f:
        fields=['id','team','rank','rating','measuredGames','rawOffenseYpp','rawDefenseYppAllowed','minOpponentMeasuredGames','provisional'];writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows({k:t[k] for k in fields} for t in current['rows'])
    print(json.dumps({'output':str(output),'model':selected,'coverage':current['measuredFbsTeams'],'allFbs':current['sourceFbsTeams'],'games':current['gamesUsed']}),flush=True)


if __name__=='__main__':main()
