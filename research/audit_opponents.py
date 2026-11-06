"""Research-only current opponent audit, bound to the saved publication.

Later-fetched public evidence corroborates data; it cannot certify what was
available at the original cutoff. No source result is automatically adopted.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import html
import json
from collections import Counter,defaultdict
from datetime import datetime,timezone
from pathlib import Path

from compare_merit import ROOT,current_dataset,fit_network,merit
from replay_weekly import timestamp,protected_hashes

HERE=Path(__file__).resolve().parent


def digest(raw):return hashlib.sha256(raw).hexdigest()


def normalize_schedule_event(event,year):
    if not event.get('id'):return None,'missing-id'
    if event.get('season',{}).get('year')!=year:return None,'other-season'
    competitions=event.get('competitions',[])
    if len(competitions)!=1:return None,'competition-count'
    c=competitions[0]
    if not c.get('status',{}).get('type',{}).get('completed'):return None,'not-completed'
    players=c.get('competitors',[])
    h=[x for x in players if x.get('homeAway')=='home'];a=[x for x in players if x.get('homeAway')=='away']
    if len(h)!=1 or len(a)!=1:return None,'missing-orientation'
    h,a=h[0],a[0]
    if not h.get('id') or not a.get('id') or h['id']==a['id']:return None,'missing-identity'
    def score(row):
        value=row.get('score');value=value.get('value') if isinstance(value,dict) else value
        if value is None or isinstance(value,bool):raise ValueError('missing-score')
        numeric=float(value)
        if not numeric.is_integer() or numeric<0:raise ValueError('invalid-score')
        return int(numeric)
    try:hp,ap=score(h),score(a);timestamp(event['date'])
    except (ValueError,KeyError,TypeError):return None,'invalid-score-or-date'
    if hp==ap:return None,'tied-final-needs-policy'
    if h.get('winner')!=(hp>ap) or a.get('winner')!=(ap>hp):return None,'winner-conflict'
    if type(c.get('neutralSite')) is not bool:return None,'venue-not-explicit'
    return dict(id=str(event['id']),home=str(h['id']),away=str(a['id']),homePoints=hp,awayPoints=ap,
                startDate=event['date'],neutral=c['neutralSite'],completed=True),None


def compare_to_snapshot(game,edge):
    if {game['home'],game['away']}!={edge['a'],edge['b']}:return ['opponent-identity']
    sign=1 if edge['a']==game['home'] else -1
    outcome=(game['homePoints']>game['awayPoints'])-(game['homePoints']<game['awayPoints'])
    result=[]
    if sign*outcome!=edge['outcome']:result.append('outcome')
    if sign*(game['homePoints']-game['awayPoints'])!=edge['finalMargin']:result.append('margin')
    venue=(0 if game['neutral'] else 1)*sign
    if venue!=edge['venue']:result.append('venue')
    return result


def cutoff_class(game,asof):
    kickoff=timestamp(game['startDate']);end=timestamp(asof)
    if kickoff>end:return 'after-snapshot-kickoff'
    if kickoff+86400>end:return 'within-24h-buffer'
    return 'conservative-before-cutoff'


def read_public_evidence(snapshot,edges):
    directory=HERE/f"cache/opponents/{snapshot['snapshotHash'][:12]}/teams"
    manifest=json.loads((directory/'manifest.json').read_text())
    assert manifest['snapshotHash']==snapshot['snapshotHash']
    raw_rows=[];views=defaultdict(list);per_team={};sources={}
    for source in manifest['sources']:
        raw=(directory/source['file']).read_bytes();assert digest(raw)==source['sha256']
        payload=json.loads(raw);assert str(payload['team']['id'])==source['id']
        assert payload.get('requestedSeason',{}).get('year')==snapshot['season']
        entries=[];excluded=[]
        for event in payload['events']:
            game,reason=normalize_schedule_event(event,snapshot['season'])
            if reason:excluded.append(dict(id=event.get('id'),reason=reason));continue
            if source['id'] not in (game['home'],game['away']):raise ValueError('Schedule event omits owning team')
            entries.append(game['id']);views[game['id']].append(dict(game=game,sourceTeam=source['id']))
        per_team[source['id']]=dict(eventIds=entries,excluded=excluded)
        sources[source['id']]=source
    reconciled={};disputes=[]
    for gid,items in views.items():
        variants={json.dumps(x['game'],sort_keys=True) for x in items}
        if len(variants)!=1:
            # Do not merge conflicting timestamps/venue just because scores match.
            disputes.append(dict(id=gid,reason='public-schedule-views-disagree',views=items));continue
        game=items[0]['game'];game['sourceTeams']=sorted({x['sourceTeam'] for x in items})
        game['cutoffClass']=cutoff_class(game,snapshot['asOf'])
        game['snapshotMatch']=gid in edges
        if gid in edges:
            game['conflicts']=compare_to_snapshot(game,edges[gid])
            if timestamp(game['startDate'])>timestamp(snapshot['asOf']):game['conflicts'].append('later-reported-kickoff-after-snapshot')
        else:game['conflicts']=[]
        reconciled[gid]=game
    return manifest,per_team,reconciled,disputes


def team_audit(source,stored,per_team,evidence):
    tid=source['id'];original={g['gameId'] for g in stored['contributions']}
    public={gid for gid in per_team[tid]['eventIds'] if gid in evidence}
    matched=original&public
    conflicts=[dict(id=gid,fields=evidence[gid]['conflicts']) for gid in matched if evidence[gid]['conflicts']]
    missing_public=sorted(original-public)
    extras=[gid for gid in sorted(public-original) if evidence[gid]['cutoffClass']=='conservative-before-cutoff']
    pending=[gid for gid in sorted(public-original) if evidence[gid]['cutoffClass']!='conservative-before-cutoff']
    # A malformed completed target-season result cannot disappear into exclusions
    # while the report certifies the team's eligible schedule as corroborated.
    invalid_finals=[r for r in per_team[tid]['excluded'] if r['reason'] not in ('not-completed','other-season')]
    return dict(id=tid,team=stored['name'],division=stored['division'],storedGames=stored['games'],record=f'{stored["wins"]}-{stored["losses"]}',
                matchedGames=len(matched),conflicts=conflicts,storedGamesNotCorroborated=missing_public,
                laterKnownExtraCandidates=extras,laterOrRecentPublicExtras=pending,invalidOrUnresolvedEvents=invalid_finals,
                status='corroborated-in-later-schedule' if not conflicts and not missing_public and not extras and not invalid_finals else 'review-required',source=source)


def candidate_edges(evidence,dataset):
    ids={t['id'] for t in dataset['teams']};existing={g['id'] for g in dataset['games']}
    accepted=[];unresolved=[]
    for g in evidence.values():
        if g['id'] in existing or g['cutoffClass']!='conservative-before-cutoff':continue
        if g['conflicts'] or not {g['home'],g['away']}<=ids:
            unresolved.append(dict(id=g['id'],reason='unresolved-identity-or-conflict'));continue
        accepted.append(dict(id=g['id'],a=g['home'],b=g['away'],
                             outcome=(g['homePoints']>g['awayPoints'])-(g['homePoints']<g['awayPoints']),venue=0 if g['neutral'] else 1))
    return accepted,unresolved


def run_sensitivity(dataset,baseline,evidence,contextChecks=None):
    original={r['id']:r for r in baseline};team={t['id']:t for t in dataset['teams']}
    fbs={i for i,t in team.items() if t['division']=='fbs'}
    direct_fcs={g['b'] if g['a'] in fbs else g['a'] for g in dataset['games'] if
                (g['a'] in fbs)!=(g['b'] in fbs) and team[g['b'] if g['a'] in fbs else g['a']]['division']=='fcs'}
    sparse_nodes=set();links=[]
    for g in dataset['games']:
        for a,b in ((g['a'],g['b']),(g['b'],g['a'])):
            if a in direct_fcs and b not in direct_fcs and team[b]['division']!='fbs' and team[b]['games']<4:
                sparse_nodes.add(b);links.append(dict(fcs=team[a]['name'],opponent=team[b]['name'],opponentId=b,games=team[b]['games']))
    cases=[]
    for node in sorted(sparse_nodes):
        games=[g for g in dataset['games'] if node not in (g['a'],g['b'])]
        cases.append((f'withhold sparse opponent: {team[node]["name"]}',games,
                      dict(type='withholding-stress-test',nodeId=node,recordedGamesWithheld=len(dataset['games'])-len(games))))
    context=contextChecks or {'cases':[]}
    canceled={c['gameId'] for c in context['cases'] if c['verifiedStatus'] in ('original-slot-canceled-rescheduled-after-snapshot','canceled-no-final-result','canceled-original-slot')}
    if canceled:
        cases.append(('confirmed cancellation context scenario',[g for g in dataset['games'] if g['id'] not in canceled],
                      dict(type='source-backed-cancellation-scenario',removedGameIds=sorted(canceled),
                           caveat='Later primary schedule evidence identifies canceled slots; exact provider date association is checked by narrow future-import rules. No saved snapshot is rewritten.')))
    unresolved_zero={c['gameId'] for c in context['cases'] if c['verifiedStatus']=='unresolved-primary-evidence-unavailable'}
    if unresolved_zero:
        cases.append(('unresolved tied-context withholding',[g for g in dataset['games'] if g['id'] not in unresolved_zero],
                      dict(type='withholding-stress-test',removedGameIds=sorted(unresolved_zero),recordedGamesWithheld=len(unresolved_zero))))
    additions,unresolved=candidate_edges(evidence,dataset)
    if additions:cases.append(('later-known candidate omissions',dataset['games']+additions,dict(type='candidate-omission-scenario',addedGameIds=[g['id'] for g in additions])))
    ranges={r['id']:dict(team=r['team'],colleyMin=r['colleyRank'],colleyMax=r['colleyRank'],sorMin=r['sorRank'],sorMax=r['sorRank']) for r in baseline}
    results=[]
    base_top25={r['id'] for r in baseline if r['sorRank']<=25}
    for name,games,detail in cases:
        rows=merit(fit_network(dict(teams=dataset['teams'],games=games)))
        changed=[]
        for r in rows:
            base=original[r['id']];span=ranges[r['id']]
            for key in ('colley','sor'):
                span[key+'Min']=min(span[key+'Min'],r[key+'Rank']);span[key+'Max']=max(span[key+'Max'],r[key+'Rank'])
            if r['colleyRank']!=base['colleyRank'] or r['sorRank']!=base['sorRank']:
                changed.append(dict(team=r['team'],oldColley=base['colleyRank'],newColley=r['colleyRank'],oldSor=base['sorRank'],newSor=r['sorRank']))
            if detail['type']!='candidate-omission-scenario':assert (r['wins'],r['losses'])==(base['wins'],base['losses'])
        results.append(dict(name=name,**detail,sharedSorTop25=len(base_top25&{r['id'] for r in rows if r['sorRank']<=25}),
                            changedFbsTeams=len(changed),changes=changed))
    return dict(sparseIndirectLinks=links,scenarios=results,ranges=list(ranges.values()),candidateOmissions=additions,unresolvedCandidates=unresolved,
                interpretation='Scenario sensitivity, not confidence intervals or an estimate of actual missing-game bias. Withholding known evidence is a stress test. Later-known extras are candidates, not verified cutoff omissions.')


def main():
    before=protected_hashes();raw=(ROOT/'published/latest.json').read_bytes();snapshot=json.loads(raw)
    dataset=current_dataset(snapshot);teams={t['id']:t for t in snapshot['ratings']}
    edges={g['id']:dict(g,finalMargin=next(d['finalMargin'] for d in teams[g['a']]['contributions'] if d['gameId']==g['id'])) for g in dataset['games']}
    baseline=merit(fit_network(dataset));current={r['id']:r for r in baseline}
    assert all(abs(r['colley']-teams[r['id']]['achievement'])<1e-9 and r['colleyRank']==teams[r['id']]['rank'] for r in baseline)
    manifest,per_team,evidence,disputes=read_public_evidence(snapshot,edges)
    audits=[]
    for source in manifest['sources']:
        audits.append(team_audit(source,teams[source['id']],per_team,evidence))
    print('Schedules reconciled; running indirect sparse-evidence tests',flush=True)
    context_checks=json.loads((HERE/'results/opponents/context-zero-checks.json').read_text())
    sensitivity=run_sensitivity(dataset,baseline,evidence,context_checks)
    rank_audits=[];audited={a['id']:a for a in audits};spans={t['team']:t for t in sensitivity['ranges']}
    for r in sorted(baseline,key=lambda r:r['colleyRank']):
        t=teams[r['id']];fcs=[g['opponentId'] for g in t['contributions'] if teams[g['opponentId']]['division']=='fcs']
        rank_audits.append(dict(team=t['name'],record=f'{t["wins"]}-{t["losses"]}',colley=r['colleyRank'],sor=r['sorRank'],
                               directFcsOpponents=[dict(team=teams[i]['name'],games=teams[i]['games'],record=f'{teams[i]["wins"]}-{teams[i]["losses"]}',status=audited[i]['status']) for i in fcs],
                               sensitivity=spans[t['name']]))
    assert protected_hashes()==before
    counts=dict(auditedTeams=len(audits),auditedFbs=sum(a['division']=='fbs' for a in audits),auditedDirectFcs=sum(a['division']=='fcs' for a in audits),
                schedulesWithoutEligibleDiscrepancy=sum(a['status']=='corroborated-in-later-schedule' for a in audits),
                uniquePublishedGamesCorroborated=len({gid for a in audits for gid in per_team[a['id']]['eventIds'] if gid in edges and gid in evidence and not evidence[gid]['conflicts']}),
                uniqueConflictedGames=len({x['id'] for a in audits for x in a['conflicts']}),candidateOmissions=len(sensitivity['candidateOmissions']),publicViewDisputes=len(disputes),
                recentOrLaterFinalsHeldAside=len({gid for a in audits for gid in a['laterOrRecentPublicExtras']}))
    report=dict(snapshotAsOf=snapshot['asOf'],snapshotHash=snapshot['snapshotHash'],snapshotFileSha256=digest(raw),
                counts=counts,teamAudits=audits,rankAudits=rank_audits,evidence=list(evidence.values()),publicViewDisputes=disputes,sensitivity=sensitivity,
                sourceManifest=manifest,productionUnchanged=True,
                primarySourceChecks=json.loads((HERE/'results/opponents/primary-source-checks.json').read_text()),
                tiedContextChecks=json.loads((HERE/'results/opponents/context-zero-checks.json').read_text()),
                limits=['Later-fetched records corroborate outcomes, margins and venue encoding; the saved snapshot lacks dates and absolute scores.',
                        'This is not certification of exactly what was available at the historical cutoff.',
                        'Public schedules and CFBD may share upstream information; agreement is not full source independence.',
                        'Raw monthly scoreboards returned partial slices and were not used to certify coverage.',
                        'Subdivision membership determines publication and the SOR reference population; classifications are not prestige bonuses.',
                        'A matching public schedule is evidence of agreement, not proof that all providers omitted nothing.',
                        'No automatic corrections, rank overrides, model retuning, CFBD requests or deployments.'])
    report['implementationSha256']={name:digest((HERE/name).read_bytes()) for name in ('audit_opponents.py','compare_merit.py','replay_weekly.py')}
    report['parameters']={'sorSlope':4.2967562253807925,'sorHomeLogOdds':0.47455471946025424,'colleyPrior':2}
    report['auditFingerprint']=digest(json.dumps(dict(snapshot=snapshot['snapshotHash'],sourceHashes=[s['sha256'] for s in manifest['sources']],
                                                   implementation=report['implementationSha256'],parameters=report['parameters'],
                                                   primarySources=digest((HERE/'results/opponents/primary-source-checks.json').read_bytes()),
                                                   tiedContext=digest((HERE/'results/opponents/context-zero-checks.json').read_bytes())),sort_keys=True).encode())
    directory=HERE/f"results/opponents/{report['auditFingerprint'][:12]}";directory.mkdir(parents=True,exist_ok=True)
    (directory/'opponent-audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    write_report(report,directory)
    print(json.dumps(dict(output=str(directory),counts=counts,scenarios=len(sensitivity['scenarios']),
                          maxColleyRange=max(x['colleyMax']-x['colleyMin'] for x in sensitivity['ranges']),
                          maxSorRange=max(x['sorMax']-x['sorMin'] for x in sensitivity['ranges'])),indent=2),flush=True)


def write_report(report,directory):
    with (directory/'all-fbs-opponents.csv').open('w',newline='',encoding='utf-8-sig') as f:
        keys=['team','record','colley','sor','fcsOpponents','fcsAuditStatus','colleyScenarioMin','colleyScenarioMax','sorScenarioMin','sorScenarioMax']
        writer=csv.DictWriter(f,fieldnames=keys);writer.writeheader()
        for t in report['rankAudits']:
            writer.writerow(dict(team=t['team'],record=t['record'],colley=t['colley'],sor=t['sor'],fcsOpponents='; '.join(x['team'] for x in t['directFcsOpponents']),
                                 fcsAuditStatus='; '.join(x['status'] for x in t['directFcsOpponents']),
                                 colleyScenarioMin=t['sensitivity']['colleyMin'],colleyScenarioMax=t['sensitivity']['colleyMax'],sorScenarioMin=t['sensitivity']['sorMin'],sorScenarioMax=t['sensitivity']['sorMax']))
    rows=''.join(f"<tr><td>{html.escape(t['team'])}</td><td>{t['record']}</td><td>{t['colley']}</td><td>{t['sor']}</td><td>{html.escape('; '.join(x['team'] for x in t['directFcsOpponents'])) or 'None'}</td><td>{t['sensitivity']['colleyMin']}–{t['sensitivity']['colleyMax']}</td><td>{t['sensitivity']['sorMin']}–{t['sensitivity']['sorMax']}</td></tr>" for t in report['rankAudits'])
    c=report['counts'];scenarios=report['sensitivity']['scenarios']
    context_rows=''.join(f"<tr><td>{html.escape(' vs '.join(t['name'] for t in case['teams']))}</td><td>{html.escape(case['verifiedStatus'])}</td><td>{('<a href='+html.escape(case['sourceUrls'][0],quote=True)+'>Official source</a>') if case.get('sourceUrls') else 'Primary source unavailable; unresolved'}</td></tr>" for case in report['tiedContextChecks']['cases'])
    membership_rows=''.join(f"<li>{html.escape(case['name'])}: {html.escape(case['verifiedClassification'].upper())}. <a href='{html.escape(case['sourceUrls'][0],quote=True)}'>Primary source</a>.</li>" for case in report['primarySourceChecks']['membershipChecks'])
    text=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Current opponent-quality audit</title><style>body{{font:16px/1.6 system-ui,sans-serif;max-width:1150px;margin:36px auto;padding:0 24px;color:#172b40}}.note,th{{background:#edf3f8}}.note{{padding:16px}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{padding:9px;border-bottom:1px solid #dce3eb;text-align:left}}.scroll{{overflow:auto}}a{{color:#145a90}}code{{overflow-wrap:anywhere}}</style>
<h1>Current opponent-quality audit</h1><p class="note"><strong>Research only. Public rankings are unchanged.</strong> Saved snapshot: {report['snapshotAsOf']} (November 5, 2026 Mountain Time).</p><p>The audit covers all {c['auditedFbs']} published FBS teams and their {c['auditedDirectFcs']} distinct direct FCS opponents. Their later-fetched public team schedules were checked by team identities, outcomes, final margins and venue encoding. The saved snapshot does not retain absolute scores or kickoff dates; this report does not claim to verify those against its contribution records.</p>
<h2>Findings</h2><ul><li>{c['schedulesWithoutEligibleDiscrepancy']} of {c['auditedTeams']} team schedules have no discrepancy among the eligible older games.</li><li>{c['uniquePublishedGamesCorroborated']} distinct published games corroborated; {c['uniqueConflictedGames']} games with a detected outcome, margin, identity, venue or cutoff conflict.</li><li>{c['candidateOmissions']} conservative-before-cutoff candidate omissions; {c['publicViewDisputes']} disagreements between public schedule views.</li><li>{c['recentOrLaterFinalsHeldAside']} later-known recent finals were held aside. These involve FAU–UTSA, Southern Miss–James Madison, and Delaware State–Howard. Their kickoffs fall inside the 24-hour ambiguity window; later final scores cannot establish what was available at the saved cutoff. The later schedules are not being declared identical to the original snapshot.</li></ul>
<h2>Sensitivity to indirect sparse evidence</h2><p>{len(scenarios)} scenarios recalculate the full opponent network and SOR reference. Withholding all recorded games of each sparse indirect opponent is a stress test. It does not estimate how many real games are missing and does not produce confidence intervals. Where candidate omissions exist, an explicitly labeled supplemental scenario is evaluated without adopting it into production.</p>
<h2>Lower-division tied context needs individual review</h2><p>The saved graph includes six non-FBS zero-margin edges. The snapshot does not expose absolute final scores, so these cannot all be described as zero-zero games. Primary sources establish four canceled original slots, one genuine completed 16–16 weather-shortened game, and one unresolved case. The sensitivity tests include separate cancellation and unresolved-context scenarios. The valid tie remains in the model.</p><div class="scroll"><table><tr><th>Matchup</th><th>Evidence status</th><th>Source</th></tr>{context_rows}</table></div><p>The next importer uses narrowly scoped rules for a provider-reported zero-zero final matching the confirmed canceled slot's year, ID, participants and date window. A later played rematch, a real nonzero tie, or the unresolved game is not automatically discarded. The saved publication remains unchanged.</p>
<h2>Selected independent membership checks</h2><ul>{membership_rows}</ul><p>These checks confirm selected transition edge cases, not every historical membership entry. Official results also corroborate nine-game records for UTRGV (4–5) and Mercyhurst (1–8) through October 31. The later-source timing caveat still applies.</p>
<p>The ranges below include the baseline and these particular scenarios only. Equal rules do not impose equal team strengths. No subdivision penalty or conference bonus was introduced.</p>
<h2>All FBS teams</h2><div class="scroll"><table><tr><th>Team</th><th>Record</th><th>Colley</th><th>SOR</th><th>Direct FCS opponents</th><th>Colley scenario range</th><th>SOR scenario range</th></tr>{rows}</table></div>
<h2>Limits and next decision</h2><p>These later-fetched schedules cannot establish historical result-availability times, and the providers may share upstream information. Complete publication-time source evidence begins with the next weekly artifact capture. Narrow scenario ranges do not establish universal ranking certainty. Membership checks must use season-specific football designations; changing the FBS reference population can legitimately affect SOR.</p>
<p>Keep current formulas unchanged. Review any flagged discrepancies before correcting inputs. Only freeze a prospective comparison after reviewing this evidence; historical agreement alone does not select a winning model.</p><p><a href="all-fbs-opponents.csv">All-team CSV</a> · <a href="opponent-audit.json">Full evidence, source URLs and sensitivity cases</a></p><p>Audit fingerprint: <code>{report['auditFingerprint']}</code>. No CFBD calls, paid services, deployments or ranking overrides.</p></html>'''
    (directory/'summary.html').write_text(text,encoding='utf-8')


if __name__=='__main__':main()
