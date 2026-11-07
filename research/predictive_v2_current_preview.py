"""Dated current illustration of the frozen recorded-count research model.

This is not a pregame replay or a newly captured future forecast. No dates are
invented for the completed graph recovered from the retained primary snapshot.
Only derived ratings, support counts and checksums may leave the private cache.
"""
from __future__ import annotations

import csv
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path

from predictive_v2_ingest import FEATURES, parse_stats
from predictive_v2_model import fit_unit_metrics
from predictive_v2_experiment import predict_matchup

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SHA = lambda raw: hashlib.sha256(raw).hexdigest()
TOLERANCE = 1e-10


def recover_graph(snapshot):
    """Recover paired participant/venue facts, without assigning kickoff times."""
    if snapshot.get('source', {}).get('provider') != 'cfbd' or not snapshot.get('snapshotHash'):
        raise ValueError('A retained CFBD primary snapshot is required')
    config = snapshot['config']; cap = config['marginCap']; home_advantage = config['homeAdvantage']
    if not all(isinstance(value, (int, float)) and math.isfinite(value) and value > 0 for value in (cap, home_advantage)):
        raise ValueError('Positive venue-recovery settings required')
    teams = {}; occurrences = defaultdict(list)
    for row in snapshot['ratings']:
        if row['id'] in teams or row['games'] != len(row['contributions']):
            raise ValueError('Duplicate team or incomplete primary game evidence')
        teams[row['id']] = {key: row.get(key) for key in ('id', 'name', 'division', 'conference')}
        for game in row['contributions']:
            occurrences[game['gameId']].append((row['id'], game))
    games = []
    for identity, pair in sorted(occurrences.items()):
        if len(pair) != 2:
            raise ValueError('Completed game evidence is not paired')
        (a, left), (b, right) = pair
        margin = left['finalMargin']; adjusted = left['adjustedMargin']
        if (a == b or left['opponentId'] != b or right['opponentId'] != a or
                type(margin) is not int or right['finalMargin'] != -margin or
                abs(adjusted+right['adjustedMargin']) > 1e-8):
            raise ValueError('Reciprocal participants or score margins disagree')
        outcome = (margin > 0)-(margin < 0)
        venues = {venue for base in {margin, outcome} for venue in (-1, 0, 1)
                  if abs(cap*math.tanh(base/cap)-venue*home_advantage-adjusted) < 1e-8}
        if len(venues) != 1:
            raise ValueError('Completed game venue is ambiguous')
        venue = venues.pop()
        home, away = (b, a) if venue == -1 else (a, b)
        if venue == 0:
            home, away = sorted((a, b))
        games.append(dict(id=identity, home=home, away=away, neutral=venue == 0))
    if len(games) != snapshot['gamesUsed']:
        raise ValueError('Recovered completed game count differs from primary publication')
    return teams, games


def shared_ranks(values):
    order = sorted(values, key=lambda identity: (-values[identity], identity))
    result = {}; previous = None; rank = None
    for position, identity in enumerate(order, 1):
        if previous is None or abs(values[identity]-previous) > TOLERANCE:
            rank = position; previous = values[identity]
        result[identity] = rank
    return result


def verified_comparisons(snapshot, sor_snapshot, performance):
    if any(other.get('season') != snapshot['season'] or other.get('asOf') != snapshot['asOf']
           for other in (sor_snapshot, performance)):
        raise ValueError('Comparison snapshots have different seasons or cutoffs')
    if (sor_snapshot.get('snapshotHash') != snapshot['snapshotHash'] or
            performance.get('baseSnapshotHash') != snapshot['snapshotHash']):
        raise ValueError('Comparison snapshot identity differs')
    primary = {row['id']: row for row in snapshot['rankings']}
    sor = {row['id']: row for row in sor_snapshot['rankings']}
    perf = {row['id']: row for row in performance['rankings']}
    if len(primary) != len(snapshot['rankings']) or set(primary) != set(sor) or set(primary) != set(perf):
        raise ValueError('Comparison FBS populations differ')
    for identity, row in primary.items():
        other = sor[identity]
        if any(row[key] != other[key] for key in ('games', 'wins', 'losses')) or abs(row['strength']-other['strength']) > 1e-8:
            raise ValueError('Comparison records or own Strength differ')
    return sor, perf


def build_preview(snapshot, csv_text, artifact, sor_snapshot, performance, *, provenance, generated_at=None):
    if (artifact.get('status') != 'research-only' or artifact.get('trainedThroughSeason') != 2019 or
            artifact['currentOwnStrengthConfiguration'] != snapshot['config']):
        raise ValueError('Frozen research artifact or baseline settings differ')
    columns = artifact['logistic']['columns']
    if (set(columns)-set(FEATURES)-{'strength', 'venue'} or
            len(columns) != len(artifact['logistic']['coefficients']) or len(columns) != len(artifact['logistic']['scale'])):
        raise ValueError('Unknown model inputs or inconsistent fitted columns')
    teams, games = recover_graph(snapshot)
    sor, perf = verified_comparisons(snapshot, sor_snapshot, performance)
    known = {identity: team for identity, team in teams.items() if team['division'] in ('fbs', 'fcs')}
    d1_games = [game for game in games if game['home'] in known and game['away'] in known]
    eligible = {game['id']: game for game in d1_games}
    raw_by_game = defaultdict(list)
    for raw in csv.DictReader(io.StringIO(csv_text)):
        if str(raw.get('season')) != str(snapshot['season']):
            raise ValueError('Wrong-season recorded box row')
        raw_by_game[raw['game_id']].append(raw)
    metrics = [name for name in columns if name in FEATURES]
    observations = {metric: [] for metric in metrics}
    basic_counts = Counter(); paired_ids = set(); basic_ids = set(); missing = []; metric_ids = {name: set() for name in metrics}
    unit_side_counts = {name: Counter() for name in metrics}
    expected_fbs = {game['id'] for game in d1_games if any(known[game[side]]['division'] == 'fbs' for side in ('home', 'away'))}
    for game in d1_games:
        pair = raw_by_game.get(game['id'], [])
        reason = None
        if len(pair) != 2:
            reason = 'missing-box-pair' if not pair else 'partial-or-duplicate-box'
        elif {row['team_id'] for row in pair} != {game['home'], game['away']}:
            reason = 'recorded-participants-disagree'
        elif {row.get('home_away') for row in pair} != {'home', 'away'}:
            reason = 'invalid-recorded-venue-pair'
        elif not game['neutral'] and next(row['team_id'] for row in pair if row['home_away'] == 'home') != game['home']:
            reason = 'recorded-venue-disagrees'
        if reason:
            missing.append(dict(gameId=game['id'], reason=reason, involvesFbs=game['id'] in expected_fbs)); continue
        paired_ids.add(game['id'])
        mapped = {row['team_id']: parse_stats(row) for row in pair}
        if all(mapped[game[side]]['features']['ypp'] is not None for side in ('home', 'away')):
            basic_ids.add(game['id']); basic_counts.update((game['home'], game['away']))
        for metric in metrics:
            both = True
            for side, other, sign in [('home', 'away', 1), ('away', 'home', -1)]:
                value = mapped[game[side]]['features'][metric]
                if value is None:
                    both = False; continue
                observations[metric].append(dict(gameId=game['id'], offense=game[side], defense=game[other],
                                                 venue=0 if game['neutral'] else sign, value=value))
                unit_side_counts[metric][game[side]] += 1
            if both:
                metric_ids[metric].add(game['id'])
    fitted = fit_unit_metrics(list(known.values()), observations, artifact['unitConfiguration'])
    fitted_by_id = {metric: {row['id']: row for row in model['ratings']} for metric, model in fitted.items()}
    weights = {name: coefficient/scale for name, coefficient, scale in
               zip(columns, artifact['logistic']['coefficients'], artifact['logistic']['scale'])}
    fbs = {row['id']: row for row in snapshot['rankings']}
    if len(fbs) != len(snapshot['rankings']) or any(identity not in known or known[identity]['division'] != 'fbs' for identity in fbs):
        raise ValueError('Published FBS rows do not match known source membership')
    available = [identity for identity in fbs if fbs[identity]['games'] >= 4 and basic_counts[identity] >= 4]
    if not available:
        raise ValueError('No FBS team has the declared minimum raw-stat support')
    components = {}; uncentered = {}
    for identity, row in fbs.items():
        terms = {'strength': weights.get('strength', 0)*row['strength']}
        terms.update({metric: weights[metric]*(fitted_by_id[metric][identity]['offenseEffect']-
                                                fitted_by_id[metric][identity]['allowanceEffect']) for metric in metrics})
        components[identity] = terms; uncentered[identity] = sum(terms.values())
    center = sum(uncentered[identity] for identity in available)/len(available)
    values = {identity: uncentered[identity]-center for identity in available}
    ranks = shared_ranks(values)
    strength_ranks = shared_ranks({identity: row['strength'] for identity, row in fbs.items()})
    rows = []
    for identity, row in fbs.items():
        terms = dict(components[identity], centeringAdjustment=-center)
        support = {metric: {key: fitted_by_id[metric][identity][key] for key in
                           ('offenseEffect', 'allowanceEffect', 'offenseGames', 'defenseGames', 'measuredGames')}
                   for metric in metrics}
        if identity in values and abs(sum(terms.values())-values[identity]) > 1e-10:
            raise ValueError('Current additive model score does not reconcile')
        rows.append(dict(id=identity, name=row['name'], conference=row['conference'], wins=row['wins'], losses=row['losses'], games=row['games'],
                         rank=ranks.get(identity), score=values.get(identity), sorRank=sor[identity]['displayRank'],
                         strengthRank=strength_ranks[identity], performanceRank=perf[identity]['rank'],
                         basicMeasuredGames=basic_counts[identity], components=terms, metrics=support,
                         unavailableReason=None if identity in values else 'Fewer than four completed outcome and measured basic-stat games'))
    rows.sort(key=lambda row: (row['rank'] is None, row['rank'] or 9999, row['id']))
    # For FBS-FBS neutral fixtures, the centered score difference must exactly
    # match the portable model's log odds. No current order selects the weights.
    agreement = 0.; anchor = available[0]
    strength = {identity: row['strength'] for identity, row in fbs.items()}
    for other in available[1:]:
        predicted = predict_matchup(artifact, fitted, strength, anchor, other, 0)
        agreement = max(agreement, abs(predicted['logOdds']-(values[anchor]-values[other])))
    if agreement > 1e-10:
        raise ValueError('Current neutral score differs from the frozen portable predictor')
    return dict(schemaVersion=1, status='research-only-current-illustration', season=snapshot['season'], asOf=snapshot['asOf'],
        generatedAt=generated_at or datetime.now(timezone.utc).isoformat(), baseSnapshotHash=snapshot['snapshotHash'],
        model=dict(id=artifact['id'], family=artifact['family'], experimentFingerprint=artifact['experimentFingerprint'],
                   trainedThroughSeason=artifact['trainedThroughSeason'], scoreLabel='Neutral model score',
                   scoreUnits='Centered log-odds index; not a win probability',
                   definition='Own Strength plus independently reconstructed offense/defense efficiency units; fixed older-trained coefficients'),
        coverage=dict(sourceFbsTeams=len(fbs), rankedFbsTeams=len(available), completedPrimaryGames=len(games),
                      expectedKnownD1Games=len(d1_games), expectedFbsGames=len(expected_fbs),
                      pairedKnownD1Games=len(paired_ids), pairedFbsGames=len(paired_ids & expected_fbs),
                      expectedFcsContextGames=len(d1_games)-len(expected_fbs),
                      pairedFcsContextGames=len(paired_ids)-len(paired_ids & expected_fbs),
                      validBasicFbsGames=len(basic_ids & expected_fbs),
                      metricCoverage={metric: dict(pairedFbsGames=len(ids & expected_fbs), expectedFbsGames=len(expected_fbs),
                                                  observedUnitSides=len(observations[metric])) for metric, ids in metric_ids.items()},
                      missingFbsGameIds=sorted(expected_fbs-paired_ids), rawBoxPairIssueCounts=dict(Counter(item['reason'] for item in missing)),
                      ignoredBoxGameIdsOutsidePrimary=len(set(raw_by_game)-set(eligible))),
        provenance=provenance, validation=dict(portableNeutralLogOddsAgreement=agreement,
            maximumUnitNormalResidual=max(model['fitDiagnostics']['maximumNormalEquationResidual'] for model in fitted.values())),
        limitations=[
            'Experimental current illustration, not a promoted public ranking or a saved-before-kickoff forecast.',
            'Result cutoff is the retained primary publication date, not the page build date. No kickoff timestamps are invented for recovered games.',
            'Raw box coverage may be partial or older than the retained results; measured and missing game counts are shown and missing raw observations are never filled with zero.',
            'This retained raw-box archive contains no FCS-only game boxes. Those context games are absent from the unit fit, not represented by invented average performances.',
            'Neutral model scores are an additive index, not a win probability. Venue is omitted from this neutral ranking.',
            'The fixed probability mapping was trained through2019. Current own Strength retains its declared earlier-team-history prior.',
            'The older-selected research candidate has not established superiority over Strength; player, play, drive and full special-teams features are outside this first candidate.'
        ], rankings=rows)


def main():
    snapshot_path=ROOT/'published/latest.json'; box_path=HERE/'cache/performance/team_box_2026.csv'
    manifest_path=HERE/'cache/performance/manifest.json'; artifact_path=HERE/'results/predictive-v2/ab24aeeb21fa/model.json'
    comparisons_path=HERE/'cache/composite-preview/inputs.json'
    snapshot_bytes=snapshot_path.read_bytes(); box_bytes=box_path.read_bytes(); artifact_bytes=artifact_path.read_bytes(); manifest_bytes=manifest_path.read_bytes()
    snapshot=json.loads(snapshot_bytes); artifact=json.loads(artifact_bytes); manifest=json.loads(manifest_bytes)
    entries=[entry for entry in manifest['files'] if entry['year']==snapshot['season']]
    if len(entries)!=1 or entries[0]['sha256']!=SHA(box_bytes) or entries[0]['bytes']!=len(box_bytes):
        raise ValueError('Recorded box cache differs from its pinned source')
    for name, expected in artifact['implementationSha256'].items():
        if SHA((HERE/name).read_bytes())!=expected:
            raise ValueError('Frozen older research implementation differs: '+name)
    comparisons=json.loads(comparisons_path.read_bytes())
    output=build_preview(snapshot,box_bytes.decode('utf-8-sig'),artifact,comparisons['primary'],comparisons['performance'],provenance=dict(
        primarySnapshotSha256=SHA(snapshot_bytes), recordedBoxSha256=SHA(box_bytes), modelArtifactSha256=SHA(artifact_bytes),
        previewImplementationSha256=SHA(Path(__file__).read_bytes()),
        sourceManifestSha256=SHA(manifest_bytes), recordedSource='ESPN recorded team boxes retained through checksum-pinned SportsDataverse release',
        canonicalSource='CFBD retained completed outcome graph', recordedSourceReleaseUpdatedAt=entries[0].get('releaseUpdatedAt'),
        recordedSourceRetrievedAt=entries[0].get('fetchedAt'), sourceDataRequests=0))
    target=ROOT/'review-site/data/current.json'; target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(output,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps(dict(path=str(target),ranked=output['coverage']['rankedFbsTeams'],teams=output['coverage']['sourceFbsTeams'],
                         pairedFbs=output['coverage']['pairedFbsGames'],expectedFbs=output['coverage']['expectedFbsGames'],
                         basicFbs=output['coverage']['validBasicFbsGames'],portableAgreement=output['validation']['portableNeutralLogOddsAgreement'])))


if __name__=='__main__':
    main()
