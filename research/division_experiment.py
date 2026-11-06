"""Offline, versioned residual-division experiment. No production/provider writes.

Run after restoring historical-coverage-v1. Requires only Python and NumPy.
Colley is deliberately unchanged. New coefficients belong to this experiment,
not to the existing frozen SOR implementation or published weekly comparison.
"""
from __future__ import annotations

import csv
import hashlib
import html
import json
import math
from pathlib import Path

import numpy as np

from compare_merit import (ORIGINAL, ROOT, current_dataset, fit_network, loo_context,
                           sigmoid, tail_probability)
from replay_weekly import (adapt, audit_season, available_games, protected_hashes,
                           timestamp, weekly_groups)

HERE=Path(__file__).resolve().parent
CONTEXTS=("prior-week-only","excluded-game-final-network")


def digest(value):return hashlib.sha256(value).hexdigest()


def division_indicator(a,b):
    if a not in ("fbs","fcs") or b not in ("fbs","fcs"):
        raise ValueError("Known season-specific FBS/FCS membership is required")
    return int(a=="fbs")-int(b=="fbs")


def predict(x,beta):return sigmoid(np.asarray(x)[:,:len(beta)]@np.asarray(beta))


def fit_mapping(x,y):
    """Unpenalized, symmetric logistic mapping; signs are learned, not imposed."""
    x=np.asarray(x,dtype=float);y=np.asarray(y,dtype=float)
    beta=np.zeros(x.shape[1])
    for iteration in range(100):
        z=x@beta;p=sigmoid(z)
        loss=float(np.sum(np.logaddexp(0,z)-y*z))
        gradient=x.T@(p-y)
        hessian=x.T@(x*(p*(1-p))[:,None])
        step=np.linalg.solve(hessian+np.eye(len(beta))*1e-10,gradient)
        scale=1.
        while scale>1e-8:
            candidate=beta-scale*step;zz=x@candidate
            if np.sum(np.logaddexp(0,zz)-y*zz)<=loss+1e-10:break
            scale*=.5
        beta=candidate
        if np.max(np.abs(scale*step))<1e-10 or np.max(np.abs(gradient))<1e-8:break
    final=predict(x,beta)
    diagnostic=dict(iterations=iteration+1,maxAbsGradient=float(np.max(np.abs(x.T@(final-y)))),
                    hessianConditionNumber=float(np.linalg.cond(x.T@(x*(final*(1-final))[:,None]))))
    if not np.all(np.isfinite(beta)) or diagnostic["maxAbsGradient"]>1e-5:
        raise ValueError(f"Logistic fit failed to converge: {diagnostic}")
    return beta,diagnostic


def extract_observations(data,d1_only=False,regular_only=False):
    divisions={t["id"]:t["division"] for t in data["teams"]}
    rows={context:[] for context in CONTEXTS}
    working=dict(data,games=[g for g in data["games"] if not regular_only or g["seasonType"]=="regular"])

    def eligible(g):
        return all(divisions[t] in ("fbs","fcs") for t in (g["home"],g["away"])) and g["homePoints"]!=g["awayPoints"]

    def row(g,difference,counts):
        a,b=g["home"],g["away"];da,db=divisions[a],divisions[b]
        group="FBS-FCS" if da!=db else ("FBS-FBS" if da=="fbs" else "FCS-FCS")
        venue=0 if g["neutral"] else 1
        return dict(id=g["id"],x=[float(difference),venue,division_indicator(da,db)],
                    y=int(g["homePoints"]>g["awayPoints"]),group=group,
                    block=f'{data["year"]}:{g["seasonType"]}:{g["week"]}',
                    early=min(counts.get(a,0),counts.get(b,0))<4,
                    fbsVenue=(venue if da=="fbs" else -venue) if group=="FBS-FCS" else 0)

    seen=set()
    for _,targets in weekly_groups(working):
        cutoff=min(timestamp(g["startDate"]) for g in targets)
        past=available_games(working,seen,cutoff)
        assert not {g["id"] for g in past}&{g["id"] for g in targets}
        net=fit_network(adapt(working,past),d1_only=d1_only)
        index={t["id"]:i for i,t in enumerate(net["teams"])};counts={}
        for g in net["games"]:
            for t in (g["a"],g["b"]):counts[t]=counts.get(t,0)+1
        for g in targets:
            if eligible(g):
                diff=net["ratings"][index[g["home"]]]-net["ratings"][index[g["away"]]]
                rows[CONTEXTS[0]].append(row(g,diff,counts))
        seen.update(g["id"] for g in targets)
    complete=[g for g in working["games"] if g["completed"]]
    net=fit_network(adapt(working,complete),d1_only=d1_only);loo=loo_context(net)
    by_id={g["id"]:g for g in complete};counts={}
    for g in net["games"]:
        for t in (g["a"],g["b"]):counts[t]=counts.get(t,0)+1
    for j,edge in enumerate(net["games"]):
        g=by_id[edge["id"]]
        if eligible(g):
            reduced=counts.copy()
            for t in (g["home"],g["away"]):reduced[t]-=1
            rows[CONTEXTS[1]].append(row(g,loo["home"][j]-loo["away"][j],reduced))
    result={}
    for context,rr in rows.items():
        result[context]=dict(x=np.array([r["x"] for r in rr],dtype=float).reshape(-1,3),
                             y=np.array([r["y"] for r in rr],dtype=float),
                             ids=np.array([r["id"] for r in rr]),group=np.array([r["group"] for r in rr]),
                             block=np.array([r["block"] for r in rr]),early=np.array([r["early"] for r in rr],dtype=bool),
                             fbsVenue=np.array([r["fbsVenue"] for r in rr],dtype=int))
    return result


def combine(items):return {k:np.concatenate([item[k] for item in items]) for k in items[0]}


def subset(item,mask):return {k:v[mask] for k,v in item.items()}


def metrics(item,beta,mask=None):
    if mask is not None:item=subset(item,mask)
    if not len(item["y"]):return dict(games=0)
    p=np.clip(predict(item["x"],beta),1e-12,1-1e-12);y=item["y"].copy()
    # Orient crossdivision calibration as FBS win probability, regardless of venue.
    reverse=item["x"][:,2]==-1;p[reverse]=1-p[reverse];y[reverse]=1-y[reverse]
    bins=[]
    for low,high in ((0,.5),(.5,.7),(.7,.8),(.8,.9),(.9,.95),(.95,1.0000001)):
        m=(p>=low)&(p<high)
        if np.any(m):bins.append(dict(lower=low,upper=min(high,1),games=int(sum(m)),predicted=float(p[m].mean()),observed=float(y[m].mean())))
    return dict(games=len(y),logLoss=float(np.mean(-y*np.log(p)-(1-y)*np.log(1-p))),
                brier=float(np.mean((p-y)**2)),predictedWinRate=float(p.mean()),observedWinRate=float(y.mean()),
                calibrationOrientation="FBS win for crossdivision games; home/listed-A win otherwise",bins=bins)


def score_report(item,models):
    masks={"FBS-involving":item["group"]!="FCS-FCS", "FBS-FBS":item["group"]=="FBS-FBS", "FBS-FCS":item["group"]=="FBS-FCS", "FCS-FCS-diagnostic":item["group"]=="FCS-FCS"}
    for label,m in (("early",item["early"]),("later",~item["early"]),("FBS-home",item["fbsVenue"]==1),("neutral",item["fbsVenue"]==0),("FBS-away",item["fbsVenue"]==-1)):
        masks["FBS-FCS-"+label]=(item["group"]=="FBS-FCS")&m
    return {label:{name:metrics(item,beta,mask) for name,beta in models.items()} for label,mask in masks.items()}


def block_score_stability(item,control,candidate):
    result={};rng=np.random.default_rng(20261106)
    for label in ("FBS-involving","FBS-FBS","FBS-FCS"):
        mask=item["group"]!="FCS-FCS" if label=="FBS-involving" else item["group"]==label
        d=subset(item,mask);y=d["y"]
        old=np.clip(predict(d["x"],control),1e-12,1-1e-12);new=np.clip(predict(d["x"],candidate),1e-12,1-1e-12)
        delta=(-y*np.log(old)-(1-y)*np.log(1-old))-(-y*np.log(new)-(1-y)*np.log(1-new))
        blocks=sorted(set(d["block"].tolist()));totals=np.array([sum(delta[d["block"]==b]) for b in blocks]);counts=np.array([sum(d["block"]==b) for b in blocks])
        selected=rng.integers(0,len(blocks),(2000,len(blocks)));samples=totals[selected].sum(axis=1)/counts[selected].sum(axis=1)
        result[label]=dict(games=len(y),meanLogLossReduction=float(delta.mean()),weekBlockRange95=np.quantile(samples,[.025,.975]).tolist(),blocks=len(blocks))
    result["interpretation"]="Descriptive paired season-week resampling with coefficients fixed; recurring teams violate independent-block assumptions. Not calibrated confidence intervals or prospective proof."
    return result


def coefficient_stability(training):
    primary=subset(training,training["group"]!="FCS-FCS");blocks=sorted(set(primary["block"].tolist()))
    members=[np.flatnonzero(primary["block"]==b) for b in blocks];rng=np.random.default_rng(20261106);estimates=[]
    for _ in range(200):
        selected=rng.integers(0,len(blocks),len(blocks));ii=np.concatenate([members[j] for j in selected])
        estimates.append(fit_mapping(primary["x"][ii],primary["y"][ii])[0])
    return dict(replicates=200,seed=20261106,coefficientWeekBlockRange95=np.quantile(estimates,[.025,.975],axis=0).T.tolist(),
                interpretation="Descriptive fitted-coefficient stability; recurring teams and selected schedules prevent a causal or universal population interpretation.")


def division_merit(network,beta):
    context=loo_context(network);slope,home,gap=beta;rows=[]
    for i in network["fbs"]:
        probs=[];outcomes=[]
        for j in np.flatnonzero((network["a"]==i)|(network["b"]==i)):
            is_a=network["a"][j]==i;other=network["b"][j] if is_a else network["a"][j]
            division=network["teams"][other]["division"]
            indicator=division_indicator("fbs",division)
            outcome=network["y"][j] if is_a else -network["y"][j]
            if outcome==0:raise ValueError("FBS-involving tie needs an explicit new policy")
            opponent=context["away"][j] if is_a else context["home"][j]
            venue=network["venue"][j]*(1 if is_a else -1)
            probs.append(float(sigmoid(slope*(context["reference"][j]-opponent)+home*venue+gap*indicator)))
            outcomes.append(outcome)
        if not probs:continue
        wins=int(sum(y>0 for y in outcomes));tail=tail_probability(probs,wins);t=network["teams"][i]
        rows.append(dict(id=t["id"],team=t["name"],wins=wins,losses=len(probs)-wins,colley=float(network["ratings"][i]),
                         sor=-math.log10(max(tail,1e-300)),expectedWins=float(sum(probs)),tail=tail))
    for field in ("colley","sor"):
        last=None;rank=None
        for position,row in enumerate(sorted(rows,key=lambda r:(-r[field],r["id"])),1):
            if last is None or abs(row[field]-last)>1e-9:rank=position
            row[field+"Rank"]=rank;last=row[field]
    return sorted(rows,key=lambda r:(r["sorRank"],r["id"]))


def current_impact(models):
    raw=(ROOT/"published/latest.json").read_bytes();snapshot=json.loads(raw);net=fit_network(current_dataset(snapshot))
    results={name:division_merit(net,tuple(beta)+(0.,) if len(beta)==2 else beta) for name,beta in models.items()}
    original={r["id"]:r for r in results["frozenOriginal"]};control={r["id"]:r for r in results["refitControl"]}
    by_id={t["id"]:t for t in snapshot["ratings"]};error=0.
    rows=[]
    for r in results["divisionResidual"]:
        old=original[r["id"]];base=control[r["id"]];stored=by_id[r["id"]]
        error=max(error,abs(r["colley"]-stored["achievement"]))
        assert (r["wins"],r["losses"],r["colleyRank"])==(stored["wins"],stored["losses"],stored["rank"])
        fcs=[d["opponentName"] for d in stored["contributions"] if by_id[d["opponentId"]]["division"]=="fcs"]
        rows.append(dict(id=r["id"],team=r["team"],wins=r["wins"],losses=r["losses"],colleyRank=r["colleyRank"],
                         frozenSorRank=old["sorRank"],refitControlSorRank=base["sorRank"],divisionSorRank=r["sorRank"],
                         candidateVsControlRankChange=base["sorRank"]-r["sorRank"],fcsOpponents=fcs,
                         frozenSor=old["sor"],refitControlSor=base["sor"],divisionSor=r["sor"]))
    a={r["id"] for r in results["refitControl"] if r["sorRank"]<=25};b={r["id"] for r in results["divisionResidual"] if r["sorRank"]<=25}
    names={r["id"]:r["team"] for r in rows}
    return dict(snapshotSha256=digest(raw),snapshotAsOf=snapshot["asOf"],maxColleyReconstructionError=error,
                controlCandidateTop25Overlap=len(a&b),candidateEntrants=[names[i] for i in sorted(b-a)],candidateExits=[names[i] for i in sorted(a-b)],
                interpretation="Illustrative retrospective SOR impact on one previously inspected snapshot; does not validate achievement quality. Colley and displayed SOS are unchanged.",rows=rows)


def write_report(report,output):
    (output/"experiment.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    rows=report["currentSnapshotIllustration"]["rows"]
    with (output/"current-sor-comparison.csv").open("w",newline="",encoding="utf-8-sig") as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    tr=[]
    for variant,result in report["experiments"].items():
        for context,item in result.items():
            cross=item["evaluationPooled"]["FBS-FCS"];same=item["evaluationPooled"]["FBS-FBS"]
            tr.append("<tr>"+"".join(f"<td>{html.escape(str(v))}</td>" for v in (variant,context,cross["divisionResidual"]["games"],
                round(item["coefficients"]["divisionResidual"][2],4),round(cross["refitControl"]["predictedWinRate"]*100,1),round(cross["divisionResidual"]["predictedWinRate"]*100,1),
                round(cross["divisionResidual"]["observedWinRate"]*100,1),round(cross["refitControl"]["logLoss"],5),round(cross["divisionResidual"]["logLoss"],5),
                round(same["divisionResidual"]["logLoss"]-same["refitControl"]["logLoss"],6)))+"</tr>")
    impact=report["currentSnapshotIllustration"]
    table="".join("<tr>"+"".join(f"<td>{html.escape(str(v))}</td>" for v in (r["divisionSorRank"],r["team"],f'{r["wins"]}-{r["losses"]}',r["colleyRank"],r["frozenSorRank"],r["refitControlSorRank"],r["divisionSorRank"],", ".join(r["fcsOpponents"]) or "None"))+"</tr>" for r in rows if r["divisionSorRank"]<=25)
    document=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FBS/FCS division experiment</title>
<style>body{{font:16px/1.6 system-ui;max-width:1240px;margin:32px auto;padding:0 22px;color:#183049}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{padding:8px;text-align:left;border-bottom:1px solid #d3dee8}}.scroll{{overflow:auto}}.note{{background:#eef4f8;padding:18px}}code{{overflow-wrap:anywhere}}</style>
<h1>Does the ranking math miss a division gap?</h1><p class="note"><strong>Offline research only.</strong> Live Colley rankings, the frozen SOR comparison, scheduling, source data and website remain unchanged. Zero CFBD calls and no paid services. Fingerprint: <code>{report['runFingerprint']}</code>.</p>
<p>We kept each opponent's results and schedule network, then tested whether an additional FBS/FCS indicator improved the probability mapping after venue. Training: 2014–2019. Later evaluation: 2021–2025; anomalous 2020 is reported separately. These years have already been inspected in earlier research and are not untouched tests.</p>
<p>Each challenger is compared with a freshly fitted two-variable control using exactly the same training games. The frozen original is also retained in the detailed results. Preweek estimates and excluded-game final-network estimates are fitted separately. Final-network reconstructions use other later results and must not be read as pregame forecasts.</p>
<h2>Later-season FBS/FCS calibration</h2><div class="scroll"><table><thead><tr><th>Network</th><th>Context</th><th>Games</th><th>Residual log-odds</th><th>Control predicted FBS wins %</th><th>Candidate predicted %</th><th>Observed %</th><th>Control log loss</th><th>Candidate log loss</th><th>FBS/FBS log-loss change</th></tr></thead><tbody>{''.join(tr)}</tbody></table></div>
<p>Lower log loss and Brier scores mean better probability estimates. Positive residual log-odds means the control underestimated FBS success in the selected crossdivision games. It is not a percentage deduction, a causal talent measure, or a conference bonus. FBS/FBS predictions can change because slope and home coefficients are refitted, even though their direct division indicator is zero.</p>
<h2>What the current snapshot would look like</h2><p>As of {html.escape(impact['snapshotAsOf'])}, excluded-game coefficients from the full-source experiment only. This illustrates SOR sensitivity, not an approved replacement. Current Colley ranks and displayed SOS do not change. The nested control and candidate share {impact['controlCandidateTop25Overlap']} Top-25 teams.</p><div class="scroll"><table><thead><tr><th>#</th><th>Team</th><th>Record</th><th>Live Colley</th><th>Frozen SOR</th><th>Refit control SOR</th><th>Division SOR</th><th>FCS opponents</th></tr></thead><tbody>{table}</tbody></table></div>
<h2>Limits and next decision</h2><ul>{''.join('<li>'+html.escape(s)+'</li>' for s in report['limitations'])}</ul><p>No candidate is promoted by this experiment. Probability calibration is necessary for SOR but cannot establish which achievement order is fair. Better historical FCS context and genuinely future frozen evaluation remain material next steps.</p>
<p><a href="experiment.json">Detailed coefficients, subgroup scores, stability checks and input hashes</a> · <a href="current-sor-comparison.csv">All-team current comparison CSV</a> · <a href="../data-audit.json">Historical data audit</a></p></html>'''
    (output/"summary.html").write_text(document,encoding="utf-8")


def main():
    protocol_raw=(HERE/"division-protocol.json").read_bytes();protocol=json.loads(protocol_raw)
    before=protected_hashes();frozen_raw=(HERE/"frozen-comparison.json").read_bytes();frozen_before=digest(frozen_raw)
    frozen_code=json.loads(frozen_raw)["implementationSha256"]
    assert all(digest((ROOT/name).read_bytes())==sha for name,sha in frozen_code.items()),"Frozen implementation does not match protocol"
    implementations={name:digest((HERE/name).read_bytes()) for name in ("division_experiment.py","test_divisions.py","compare_merit.py","replay_weekly.py")}
    years=protocol["trainingYears"]+[protocol["stressYear"]]+protocol["evaluationYears"]
    input_hashes={};datasets={}
    for year in years:
        path=HERE/f"datasets/historical-coverage-v1/seasons/{year}.json";raw=path.read_bytes();data=json.loads(raw)
        audit_season(data);datasets[year]=data;input_hashes[str(year)]=digest(raw)
    fingerprint=digest(protocol_raw+json.dumps(dict(inputs=input_hashes,implementation=implementations,current=digest((ROOT/"published/latest.json").read_bytes())),sort_keys=True).encode())
    cache=HERE/"cache/divisions";cache.mkdir(parents=True,exist_ok=True)
    experiments={};current_models=None
    for variant,d1,regular in (("fullSource",False,False),("knownD1Only",True,False),("regularSeasonOnly",False,True)):
        features={}
        for year in years:
            key=digest((input_hashes[str(year)]+json.dumps(implementations,sort_keys=True)+variant).encode())
            target=cache/f"{year}-{key}.npz"
            if target.exists():
                with np.load(target,allow_pickle=False) as saved:features[year]={context:{k:saved[f'{context}::{k}'] for k in ("x","y","ids","group","block","early","fbsVenue")} for context in CONTEXTS}
            else:
                features[year]=extract_observations(datasets[year],d1,regular)
                np.savez_compressed(target,**{f'{c}::{k}':v for c,item in features[year].items() for k,v in item.items()})
            print(variant,year,"features",len(features[year][CONTEXTS[0]]["y"]),flush=True)
        result={}
        for context in CONTEXTS:
            training=combine([features[y][context] for y in protocol["trainingYears"]]);primary=subset(training,training["group"]!="FCS-FCS")
            control,cd=fit_mapping(primary["x"][:,:2],primary["y"]);candidate,dd=fit_mapping(primary["x"],primary["y"])
            models=dict(frozenOriginal=np.array(ORIGINAL),refitControl=control,divisionResidual=candidate)
            evaluation=combine([features[y][context] for y in protocol["evaluationYears"]])
            dropped={}
            for omitted in protocol["trainingYears"]:
                sample=combine([features[y][context] for y in protocol["trainingYears"] if y!=omitted]);sample=subset(sample,sample["group"]!="FCS-FCS")
                dropped[str(omitted)]=fit_mapping(sample["x"],sample["y"])[0].tolist()
            item=dict(coefficients={name:beta.tolist() for name,beta in models.items()},coefficientOrder=["ratingSlope","homeLogOdds","divisionResidualLogOdds"],
                trainingGames=len(primary["y"]),trainingCrossdivisionGames=int(sum(primary["group"]=="FBS-FCS")),fitDiagnostics=dict(control=cd,candidate=dd),
                leaveOneTrainingSeasonOut=dropped,parameterStability=coefficient_stability(training),
                trainingScores=score_report(training,models),evaluationPooled=score_report(evaluation,models),
                evaluationByYear={str(y):score_report(features[y][context],models) for y in protocol["evaluationYears"]},
                pandemic2020Stress=score_report(features[protocol["stressYear"]][context],models),pairedScoreStability=block_score_stability(evaluation,control,candidate))
            if variant=="fullSource":
                all_beta,diag=fit_mapping(training["x"],training["y"])
                item["allKnownD1FitSensitivity"]=dict(coefficients=all_beta.tolist(),trainingGames=len(training["y"]),fitDiagnostics=diag,evaluationPooled=score_report(evaluation,dict(primaryDivision=candidate,allD1Division=all_beta)))
                if context==CONTEXTS[1]:current_models=models
            result[context]=item
            print(variant,context,"coefficients",candidate.tolist(),"cross log losses",{m:round(v["logLoss"],6) for m,v in item["evaluationPooled"]["FBS-FCS"].items()},flush=True)
        experiments[variant]=result
    impact=current_impact(current_models)
    assert before==protected_hashes(),"Production files changed during experiment"
    assert frozen_before==digest((HERE/"frozen-comparison.json").read_bytes()),"Frozen comparison changed"
    assert all(digest((ROOT/name).read_bytes())==sha for name,sha in frozen_code.items()),"Frozen implementation changed"
    report=dict(protocol=protocol,runFingerprint=fingerprint,protocolSha256=digest(protocol_raw),inputSha256=input_hashes,implementationSha256=implementations,
                productionUnchanged=True,frozenComparisonUnchanged=True,protectedProductionFiles=before,cfbdCalls=0,experiments=experiments,currentSnapshotIllustration=impact,
                limitations=["Exploratory retrospective analysis of previously inspected years; no independent prospective superiority claim.",
                    "Source FCS playoff coverage is incomplete, and lower-division context coverage changes substantially across years. An extra coefficient may compensate for missing context or Colley shrinkage.",
                    "Predominantly FBS home games and selective scheduling prevent interpreting the coefficient as a neutral-field population talent gap.",
                    "Season-specific source labels are retained; transitional membership is not universal NCAA certification. Unknown subdivisions are excluded from fitting, never silently treated as FCS.",
                    "The 2020 pandemic season is stress reporting only and is excluded from pooled later-season scores.",
                    "Preweek probabilities use a conservative 24-hour availability approximation. Final-network excluded-game estimates are retrospective, not pregame forecasts.",
                    "Week-block resampling is descriptive: teams recur across blocks, years were already inspected, and parameters stay fixed for score comparisons.",
                    "The current-snapshot ranking illustration uses full-source excluded-game coefficients only; parameters were not selected to produce familiar teams or Top-25 changes.",
                    "Changing the probability mapping does not validate an achievement order or change the public Colley engine, its SOS, historical priors, frozen v1 or site."])
    output=HERE/"results/divisions"/fingerprint[:12];output.mkdir(parents=True,exist_ok=True);write_report(report,output)
    print(json.dumps(dict(output=str(output),currentOverlap=impact["controlCandidateTop25Overlap"],entrants=impact["candidateEntrants"],exits=impact["candidateExits"],cfbdCalls=0)),flush=True)


if __name__=="__main__":main()
