"""Repeat the declared division experiment on a parented FCS repair dataset."""
import csv
import gzip
import hashlib
import html
import json
from pathlib import Path

import numpy as np

from compare_merit import ORIGINAL, ROOT, current_dataset, fit_network, loo_context, sigmoid
from division_experiment import (CONTEXTS, block_score_stability, coefficient_stability,
                                 combine, current_impact, division_merit, extract_observations,
                                 fit_mapping, predict, score_report, subset)
from replay_weekly import audit_season, protected_hashes

HERE=Path(__file__).resolve().parent
sha=lambda raw:hashlib.sha256(raw).hexdigest()


def upset_diagnostic(observations,models):
    mask=observations["group"]=="FBS-FCS";d=subset(observations,mask)
    fbs_won=np.where(d["x"][:,2]==1,d["y"],1-d["y"])
    result={}
    for label,m in (("FBS-wins",fbs_won==1),("FCS-upsets",fbs_won==0)):
        result[label]={}
        for name,beta in models.items():
            p=np.clip(predict(d["x"][m],beta),1e-12,1-1e-12);y=d["y"][m]
            result[label][name]=dict(games=len(y),logLoss=float(np.mean(-y*np.log(p)-(1-y)*np.log(1-p)))) if len(y) else dict(games=0)
    return result


def cases(models,parent):
    snapshot=json.loads((ROOT/"published/latest.json").read_bytes());data=current_dataset(snapshot);net=fit_network(data);loo=loo_context(net)
    candidate=models["divisionResidual"];control=models["refitControl"]
    all_models=dict(models,candidateWithoutDivision=np.array([candidate[0],candidate[1],0.]))
    calculated={name:{r["id"]:r for r in division_merit(net,tuple(beta)+(0.,) if len(beta)==2 else beta)} for name,beta in all_models.items()}
    old={r["id"]:r for r in parent["currentSnapshotIllustration"]["rows"]}
    rows=[]
    for identity,row in calculated["divisionResidual"].items():
        entries={name:result[identity] for name,result in calculated.items()}
        rows.append(dict(id=identity,team=row["team"],record=f'{row["wins"]}-{row["losses"]}',colleyRank=row["colleyRank"],
                         frozenSorRank=entries["frozenOriginal"]["sorRank"],controlSorRank=entries["refitControl"]["sorRank"],
                         candidateSorRank=row["sorRank"],candidateWithoutDivisionRank=entries["candidateWithoutDivision"]["sorRank"],
                         round1CandidateRank=old[identity]["divisionSorRank"],
                         candidateVsControlRankChange=entries["refitControl"]["sorRank"]-row["sorRank"],
                         scores={name:dict(sor=e["sor"],tail=e["tail"],expectedWins=e["expectedWins"]) for name,e in entries.items()}))
    index={t["id"]:i for i,t in enumerate(net["teams"])}
    # Select by declared largest movement, then add recurring user examples.
    selected={r["id"] for r in sorted(rows,key=lambda r:(-abs(r["candidateVsControlRankChange"]),r["id"]))[:12]}
    selected.update(r["id"] for r in rows if r["team"] in ("Texas","UTSA","New Mexico","Boise State","Northwestern"))
    details=[]
    for identity in sorted(selected):
        i=index[identity];team=net["teams"][i];games=[]
        for j in np.flatnonzero((net["a"]==i)|(net["b"]==i)):
            is_a=net["a"][j]==i;other=net["b"][j] if is_a else net["a"][j]
            opponent=net["teams"][other];opponent_r=loo["away"][j] if is_a else loo["home"][j]
            venue=int(net["venue"][j])*(1 if is_a else -1);indicator=int(opponent["division"]=="fcs")
            def probability(beta):return float(sigmoid(beta[0]*(loo["reference"][j]-opponent_r)+beta[1]*venue+(beta[2]*indicator if len(beta)==3 else 0)))
            games.append(dict(gameId=net["games"][j]["id"],opponentId=opponent["id"],opponent=opponent["name"],division=opponent["division"],
                              result="W" if (net["y"][j] if is_a else -net["y"][j])>0 else "L",venue={-1:"away",0:"neutral",1:"home"}[venue],
                              excludedGameOpponentColley=float(opponent_r),controlReferenceWinProbability=probability(control),
                              candidateReferenceWinProbability=probability(candidate),candidateWithoutDivisionProbability=probability(all_models["candidateWithoutDivision"])))
        details.append(dict(**next(r for r in rows if r["id"]==identity),games=games))
    # A direct division indicator must still allow exceptional FCS to outrate weak FBS in actual-game probabilities.
    synthetic_examples=[]
    for a,b in ((.2,.85),(.6,.4)):
        synthetic_examples.append(dict(fbsColley=a,fcsColley=b,venue="neutral",fbsWinProbability=float(sigmoid(candidate[0]*(a-b)+candidate[2])),scope="Hypothetical diagnostic, not an observed result or imposed team ordering"))
    # Flip each crossdivision outcome once, using the exact fixed-matrix rhs
    # update. This is a diagnostic, never a replacement for an actual result.
    baseline=calculated["divisionResidual"];sensitivities=[]
    for j in range(len(net["games"])):
        a,b=net["a"][j],net["b"][j]
        if {net["teams"][a]["division"],net["teams"][b]["division"]}!={"fbs","fcs"}:continue
        target=a if net["teams"][a]["division"]=="fbs" else b;identity=net["teams"][target]["id"]
        altered=dict(net);altered["y"]=net["y"].copy();altered["y"][j]*=-1
        altered["ratings"]=net["ratings"]-net["y"][j]*(net["inverse"][:,a]-net["inverse"][:,b])
        changed=next(r for r in division_merit(altered,candidate) if r["id"]==identity)
        outcome=net["y"][j]*(1 if target==a else -1)
        delta=changed["sor"]-baseline[identity]["sor"]
        assert delta*outcome<=1e-10,"Flipping a crossdivision win to a loss raised the team's SOR"
        assert changed["wins"]==baseline[identity]["wins"]-int(outcome)
        sensitivities.append(dict(gameId=net["games"][j]["id"],team=net["teams"][target]["name"],actualResult="W" if outcome>0 else "L",actualSor=baseline[identity]["sor"],flippedSor=changed["sor"],scoreChange=delta))
    return dict(rows=sorted(rows,key=lambda r:(r["candidateSorRank"],r["id"])),selectedTeams=details,overlapExamples=synthetic_examples,
                crossdivisionOutcomeFlipDiagnostic=dict(games=len(sensitivities),directionViolations=0,cases=sensitivities,interpretation="Hypothetical single-game outcome flips with the full opponent network recomputed analytically. Observed outcomes are never changed in saved rankings."))


def main():
    protocol_raw=(HERE/"round2-protocol.json").read_bytes();protocol=json.loads(protocol_raw);before=protected_hashes()
    frozen_raw=(HERE/"frozen-comparison.json").read_bytes();frozen=json.loads(frozen_raw)
    assert all(sha((ROOT/p).read_bytes())==h for p,h in frozen["implementationSha256"].items())
    manifest_raw=(HERE/"datasets/fcs-coverage-v1/manifest.json").read_bytes();manifest=json.loads(manifest_raw)
    parent_raw=(HERE/"results/divisions/1fef2d825b08/experiment.json").read_bytes();parent=json.loads(parent_raw)
    assert parent["runFingerprint"]==protocol["parentExperimentFingerprint"]
    implementations={name:sha((HERE/name).read_bytes()) for name in ("round2_experiment.py","division_experiment.py","compare_merit.py","replay_weekly.py")}
    years=protocol["trainingYears"]+[protocol["stressYear"]]+protocol["evaluationYears"]
    datasets={};inputs={}
    for year in years:
        raw=(HERE/f"datasets/fcs-coverage-v1/seasons/{year}.json").read_bytes();datasets[year]=json.loads(raw);inputs[str(year)]=sha(raw);audit_season(datasets[year])
    fingerprint=sha(protocol_raw+json.dumps(dict(inputs=inputs,code=implementations,manifest=sha(manifest_raw),parent=sha(parent_raw),current=sha((ROOT/"published/latest.json").read_bytes())),sort_keys=True).encode())
    cache=HERE/"cache/round2";cache.mkdir(parents=True,exist_ok=True);experiments={};current_models=None
    for variant,d1,regular in (("fullSource",False,False),("knownD1Only",True,False),("providerRegularOnly",False,True)):
        features={}
        for year in years:
            key=sha((inputs[str(year)]+json.dumps(implementations,sort_keys=True)+variant).encode());path=cache/f"{year}-{key}.npz"
            if path.exists():
                with np.load(path,allow_pickle=False) as saved:features[year]={c:{k:saved[f'{c}::{k}'] for k in ("x","y","ids","group","block","early","fbsVenue")} for c in CONTEXTS}
            else:
                features[year]=extract_observations(datasets[year],d1,regular)
                np.savez_compressed(path,**{f'{c}::{k}':v for c,item in features[year].items() for k,v in item.items()})
            print(variant,year,"ready",flush=True)
        contexts={}
        for context in CONTEXTS:
            training=combine([features[y][context] for y in protocol["trainingYears"]]);primary=subset(training,training["group"]!="FCS-FCS")
            control,cd=fit_mapping(primary["x"][:,:2],primary["y"]);candidate,dd=fit_mapping(primary["x"],primary["y"])
            models=dict(frozenOriginal=np.array(ORIGINAL),refitControl=control,divisionResidual=candidate)
            later=combine([features[y][context] for y in protocol["evaluationYears"]])
            contexts[context]=dict(coefficients={n:b.tolist() for n,b in models.items()},trainingGames=len(primary["y"]),trainingCrossdivisionGames=int(sum(primary["group"]=="FBS-FCS")),
                convergence=dict(control=cd,candidate=dd),parameterStability=coefficient_stability(training),evaluationPooled=score_report(later,models),
                evaluationByYear={str(y):score_report(features[y][context],models) for y in protocol["evaluationYears"]},
                pandemicStress=score_report(features[protocol["stressYear"]][context],models),pairedScoreStability=block_score_stability(later,control,candidate),
                crossdivisionWinsAndUpsets=upset_diagnostic(later,models))
            if variant=="fullSource" and context==CONTEXTS[1]:current_models=models
            print(variant,context,candidate.tolist(),flush=True)
        experiments[variant]=contexts
    impact=cases(current_models,parent)
    assert before==protected_hashes(),"Protected production files changed during numerical experiment"
    assert frozen_raw==(HERE/"frozen-comparison.json").read_bytes()
    assert all(sha((ROOT/p).read_bytes())==h for p,h in frozen["implementationSha256"].items())
    report=dict(protocol=protocol,runFingerprint=fingerprint,implementationSha256=implementations,inputSha256=inputs,repairManifestSha256=sha(manifest_raw),parentReportSha256=sha(parent_raw),
                repairManifest=manifest,experiments=experiments,currentCases=impact,publicEngineUnchanged=True,frozenV1Unchanged=True,cfbdCalls=0)
    output=HERE/"results/round2"/fingerprint[:12];output.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(report,indent=2)+"\n").encode();(output/"round2.json").write_bytes(raw);compressed=gzip.compress(raw,mtime=0);(output/"round2.json.gz").write_bytes(compressed)
    with (output/"current-ranks.csv").open("w",newline="",encoding="utf-8") as f:
        fields=[k for k in impact["rows"][0] if k!="scores"];writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows({k:r[k] for k in fields} for r in impact["rows"])
    (output/"metadata.json").write_bytes((json.dumps(dict(fingerprint=fingerprint,reportSha256=sha(raw),compressedSha256=sha(compressed),reportBytes=len(raw),compressedBytes=len(compressed)),indent=2)+"\n").encode())
    print(json.dumps(dict(output=str(output),fingerprint=fingerprint,models={c:experiments['fullSource'][c]['coefficients'] for c in CONTEXTS}),indent=2),flush=True)


if __name__=="__main__":main()
