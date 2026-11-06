"""Exploratory venue validation with repaired history; no production changes."""
import json
from pathlib import Path

import numpy as np

from compare_merit import fit_network,loo_context,calibration_observations,fit_logistic,probability_metrics,ORIGINAL
from replay_weekly import weekly_groups,available_games,timestamp,adapt

HERE=Path(__file__).resolve().parent


def chronological_observations(data,d1_only):
    fbs={t["id"] for t in data["teams"] if t["division"]=="fbs"}
    seen=set(); rows=[]; blocks=[]
    for (kind,week),targets in weekly_groups(data):
        cutoff=min(timestamp(g["startDate"]) for g in targets)
        games=available_games(data,seen,cutoff)
        assert not {g["id"] for g in games}&{g["id"] for g in targets}
        network=fit_network(adapt(data,games),d1_only=d1_only)
        index={t["id"]:i for i,t in enumerate(network["teams"])}
        for g in targets:
            if {g["home"],g["away"]}<=fbs and g["homePoints"]!=g["awayPoints"]:
                difference=float(network["ratings"][index[g["home"]]]-network["ratings"][index[g["away"]]])
                rows.append((difference,0 if g["neutral"] else 1,int(g["homePoints"]>g["awayPoints"])))
                blocks.append(f'{data["year"]}:{kind}:{week}')
        seen.update(g["id"] for g in targets)
    x=np.array([(a,b) for a,b,y in rows]); y=np.array([y for a,b,y in rows])
    return x,y,blocks


def resample_coefficients(x,y,blocks):
    unique=sorted(set(blocks)); members=[np.flatnonzero(np.array(blocks)==b) for b in unique]
    rng=np.random.default_rng(20261106); estimates=[]
    for _ in range(200):
        selected=rng.integers(0,len(unique),len(unique)); ids=np.concatenate([members[i] for i in selected])
        estimates.append(fit_logistic(x[ids],y[ids]))
    return dict(replicates=200,seed=20261106,slopeRange95=np.quantile(np.array(estimates)[:,0],[.025,.975]).tolist(),
                homeLogOddsRange95=np.quantile(np.array(estimates)[:,1],[.025,.975]).tolist(),
                interpretation="Week-block resampling stability ranges, not calibrated confidence intervals; teams recur across blocks.")


def main():
    report=dict(status="Exploratory retrospective validation; no parameter or production changes",trainingYears=list(range(2014,2020)),evaluationYears=[2023,2024,2025],populations={})
    for population,d1 in (("fullSourceNetwork",False),("fbsFcsOnly",True)):
        training={"pregame":[],"leaveOneOut":[]}; evaluation={"pregame":{},"leaveOneOut":{}}; blocks=[]
        for year in list(range(2014,2020))+[2023,2024,2025]:
            data=json.loads((HERE/f"datasets/historical-coverage-v1/seasons/{year}.json").read_text())
            x,y,bb=chronological_observations(data,d1)
            net=fit_network(adapt(data,[g for g in data["games"] if g["completed"]]),d1_only=d1)
            xx,yy=calibration_observations(net)
            if year<=2019:
                training["pregame"].append((x,y));training["leaveOneOut"].append((xx,yy));blocks.extend(bb)
            else:
                evaluation["pregame"][year]=(x,y);evaluation["leaveOneOut"][year]=(xx,yy)
        result={}
        for context in ("pregame","leaveOneOut"):
            x=np.concatenate([a for a,b in training[context]]);y=np.concatenate([b for a,b in training[context]])
            coefficients=fit_logistic(x,y)
            item=dict(trainingGames=len(y),fittedSlope=coefficients[0],fittedHomeLogOdds=coefficients[1],years={})
            if context=="pregame": item["parameterStability"]=resample_coefficients(x,y,blocks)
            for year,(xx,yy) in evaluation[context].items():
                item["years"][str(year)]={"originalFrozen":probability_metrics(xx,yy,ORIGINAL),
                                         "repairedHistoryFit":probability_metrics(xx,yy,coefficients),
                                         "originalSlopeNoVenue":probability_metrics(xx,yy,(ORIGINAL[0],0))}
            # Metrics helper has a conservative default label; make context explicit.
            for year in item["years"].values():
                for metric in year.values():
                    metric["scope"]="Prior-week-only retrospective pregame probabilities" if context=="pregame" else "Retrospective excluded-game reconstruction, not pregame forecasts"
            result[context]=item
        report["populations"][population]=result
        print(population,{k:dict(trainingGames=v["trainingGames"],slope=v["fittedSlope"],home=v["fittedHomeLogOdds"],laterLogLoss={y:{m:round(mm["logLoss"],6) for m,mm in yy.items()} for y,yy in v["years"].items()}) for k,v in result.items()},flush=True)
    report["limitations"]=["Exploratory analysis after earlier evaluation results were inspected; not untouched holdout evidence.",
                            "Repaired older FBS postseason coverage does not fix all lower-division or roster gaps.",
                            "Pregame and final-snapshot leave-one-out rating contexts differ; coefficients are not interchangeable by assumption.",
                            "Outcome probability quality is not independent proof of a better achievement order.",
                            "No team-specific adjustments, human polls, or current 2026 results were used to fit coefficients."]
    output=HERE/"results/repairs";output.mkdir(parents=True,exist_ok=True)
    (output/"venue-validation.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")


if __name__=="__main__":main()
