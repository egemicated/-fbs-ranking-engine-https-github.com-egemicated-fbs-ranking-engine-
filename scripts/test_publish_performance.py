"""Publisher safety, arithmetic and one-request collector checks; no real API."""
import copy
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

PATH = Path(__file__).with_name('publish-performance.py')
SPEC = importlib.util.spec_from_file_location('performance_publisher', PATH)
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


def fixtures():
    metadata = [('1', 'Alpha', 'fbs'), ('2', 'Beta', 'fbs'), ('3', 'Cedar', 'fcs'), ('4', 'Delta', 'fcs')]
    teams = {i: dict(id=i, name=name, division=division, conference='Fixture', games=0, contributions=[])
             for i, name, division in metadata}
    games = [dict(id='10', home='1', away='2', margin=7, rates=(.7, .4)),
             dict(id='11', home='1', away='3', margin=21, rates=(.6, .3)),
             dict(id='12', home='3', away='4', margin=-7, rates=(.5, .4))]
    rows, season_games = [], []
    for g in games:
        adjusted = 28*math.tanh(g['margin']/28)-2.5
        for who, other, sign, rate, allowed in [(g['home'], g['away'], 1, g['rates'][0], g['rates'][1]),
                                                (g['away'], g['home'], -1, g['rates'][1], g['rates'][0])]:
            teams[who]['games'] += 1
            teams[who]['contributions'].append(dict(gameId=g['id'], opponentId=other,
                                                   finalMargin=sign*g['margin'], adjustedMargin=sign*adjusted))
            rows.append(dict(gameId=int(g['id']), season=2026, team=teams[who]['name'], opponent=teams[other]['name'],
                             offense=dict(successRate=rate, plays=100), defense=dict(successRate=allowed, plays=100),
                             unknownPrivateField='do-not-publish'))
        season_games.append(dict(id=g['id'], home=g['home'], away=g['away'], neutral=False,
                                 completed=True, homePoints=max(g['margin'], 0)+7, awayPoints=max(-g['margin'], 0)+7,
                                 startDate='2026-11-01T18:00:00Z', week=10, seasonType='regular'))
    snapshot = dict(season=2026, source=dict(provider='cfbd'), asOf='2026-11-06T03:39:55.757Z',
                    snapshotHash='a'*64, config=dict(marginCap=28, homeAdvantage=2.5),
                    gamesUsed=3, fbsTeams=2, ratings=list(teams.values()), rankings=[dict(id='1'), dict(id='2')])
    season = dict(year=2026, source=dict(provider='cfbd'),
                  teams=[{k: t[k] for k in ['id', 'name', 'division', 'conference']} for t in teams.values()], games=season_games)
    policy = dict(id='fixture-performance', version='test', status='experimental', season=2026,
                  parameters=dict(ridge=1., contextPriorStrength=4., homePrior=.02, divisionPrior=.15),
                  validation=dict(originalGatePassed=False), limitations=['Experimental fixture'])
    source = dict(endpoint='https://api.collegefootballdata.com/stats/game/advanced?year=2026&seasonType=both&excludeGarbageTime=false',
                  sha256=publisher.sha(json.dumps(rows).encode()), fetchedAt='2026-11-06T20:00:00Z', requestCount=0)
    return snapshot, rows, policy, source, season


class PerformancePublicationChecks(unittest.TestCase):
    def test_complete_derived_snapshot_preserves_primary_and_reconciles_display_mean(self):
        snapshot, rows, policy, source, _ = fixtures(); before = copy.deepcopy(snapshot)
        result = publisher.build_performance(snapshot, rows, policy, source, generated_at='2026-11-06T21:00:00Z')
        self.assertEqual(snapshot, before)
        self.assertEqual(result['status'], 'experimental')
        self.assertEqual(result['baseSnapshotHash'], snapshot['snapshotHash'])
        self.assertEqual(result['asOf'], snapshot['asOf'])
        self.assertEqual(result['coverage']['measuredFbsGames'], 2)
        self.assertEqual(result['coverage']['measuredFcsContextGames'], 1)
        self.assertEqual(result['coverage']['measuredFbsTeams'], 2)
        self.assertFalse(result['validation']['originalGatePassed'])
        self.assertAlmostEqual(sum(t['score'] for t in result['rankings']), 0., places=12)
        for row in result['rankings']:
            self.assertAlmostEqual(row['score'], row['explanation']['reconstructedScore'], places=12)
            self.assertTrue(row['explanation']['gameContributions'][0]['opponentName'])
        self.assertNotIn('unknownPrivateField', json.dumps(result))
        self.assertNotIn('successes', json.dumps(result))

    def test_value_hash_excludes_operation_clock_but_binds_source_policy_and_primary(self):
        snapshot, rows, policy, source, _ = fixtures()
        one = publisher.build_performance(snapshot, rows, policy, source, generated_at='2026-11-06T21:00:00Z')
        two = publisher.build_performance(snapshot, rows, policy, dict(source, fetchedAt='2026-11-07T00:00:00Z', requestCount=1),
                                          generated_at='2026-11-07T01:00:00Z')
        self.assertEqual(one['publicationHash'], two['publicationHash'])
        for s, p, meta in [(dict(snapshot, snapshotHash='b'*64), policy, source),
                            (snapshot, dict(policy, id='other-version'), source),
                            (snapshot, policy, dict(source, sha256='c'*64))]:
            different = publisher.build_performance(s, rows, p, meta)
            self.assertNotEqual(one['publicationHash'], different['publicationHash'])

    def test_snapshot_rejects_incomplete_asymmetric_and_ambiguous_evidence(self):
        snapshot, _, _, _, _ = fixtures()
        variants = []
        bad = copy.deepcopy(snapshot); bad['ratings'][0]['contributions'].pop(); variants.append(bad)
        bad = copy.deepcopy(snapshot); bad['ratings'][0]['contributions'][0]['opponentId']='3'; variants.append(bad)
        bad = copy.deepcopy(snapshot); bad['gamesUsed']=4; variants.append(bad)
        bad = copy.deepcopy(snapshot); bad['asOf']='2026-11-06'; variants.append(bad)
        bad = copy.deepcopy(snapshot); bad['source']['provider']='sportsdataverse'; variants.append(bad)
        for bad in variants:
            with self.subTest(snapshot=bad), self.assertRaises(publisher.PublicationError):
                publisher.snapshot_context(bad)

    def test_weekly_context_uses_only_exact_snapshot_games_and_checks_identity_venue_and_outcome(self):
        snapshot, _, _, _, season = fixtures()
        season['games'].append(dict(id='99', home='2', away='4', neutral=False, completed=True,
                                    startDate='2026-12-01T18:00:00Z', homePoints=20, awayPoints=10))
        context = publisher.context_with_season(snapshot, season)
        self.assertEqual({g['id'] for g in context['games']}, {'10','11','12'})
        self.assertTrue(all(g['week']==10 for g in context['games']))
        for field, value in [('neutral', True), ('home', '2'), ('homePoints', 0), ('completed', False),
                             ('startDate', '2026-12-01T18:00:00Z')]:
            bad = copy.deepcopy(season); bad['games'][0][field]=value
            with self.subTest(field=field), self.assertRaises(publisher.PublicationError):
                publisher.context_with_season(snapshot, bad)
        bad=copy.deepcopy(season);bad['source']['provider']='sportsdataverse'
        with self.assertRaises(publisher.PublicationError):publisher.context_with_season(snapshot,bad)

    def test_invalid_stats_or_stale_context_preserve_existing_public_bytes(self):
        snapshot, rows, policy, source, _ = fixtures()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'performance.json'; path.write_bytes(b'previous-publication')
            with self.assertRaises(publisher.PublicationError):
                publisher.publish_to_file(snapshot, rows[1:], policy, source, path)
            self.assertEqual(path.read_bytes(), b'previous-publication')
            context=publisher.snapshot_context(snapshot);context['games'].pop()
            with self.assertRaises(publisher.PublicationError):
                publisher.publish_to_file(snapshot, rows, policy, source, path, context=context)
            self.assertEqual(path.read_bytes(), b'previous-publication')
            context=publisher.snapshot_context(snapshot);context['teams'][0]['division']='fcs'
            with self.assertRaises(publisher.PublicationError):
                publisher.publish_to_file(snapshot, rows, policy, source, path, context=context)
            self.assertEqual(path.read_bytes(), b'previous-publication')

    def test_cached_cli_reads_pinned_input_without_request_and_does_not_modify_primary(self):
        snapshot, rows, policy, _, _ = fixtures()
        with tempfile.TemporaryDirectory() as folder:
            d=Path(folder);paths={k:d/(k+'.json') for k in ['snapshot','source','manifest','config','output']}
            for name,data in [('snapshot',snapshot),('source',rows),('config',policy)]:paths[name].write_text(json.dumps(data))
            original=paths['snapshot'].read_bytes();raw=paths['source'].read_bytes()
            paths['manifest'].write_text(json.dumps(dict(files=[dict(year=2026,rawSha256=publisher.sha(raw),completedAt='2026-11-06T20:00:00Z')])))
            args=['--snapshot',str(paths['snapshot']),'--source',str(paths['source']),'--source-manifest',str(paths['manifest']),
                  '--config',str(paths['config']),'--output',str(paths['output'])]
            with patch.object(publisher,'fetch_source',side_effect=AssertionError('Network not allowed')),redirect_stdout(io.StringIO()):
                self.assertEqual(publisher.main(args),0)
            result=json.loads(paths['output'].read_bytes());self.assertEqual(result['source']['requestCount'],0)
            self.assertEqual(result['source']['fetchedAt'],'2026-11-06T20:00:00Z')
            self.assertEqual(paths['snapshot'].read_bytes(),original)
            public=paths['output'].read_bytes();paths['manifest'].write_text(json.dumps(dict(files=[])))
            with redirect_stderr(io.StringIO()):self.assertEqual(publisher.main(args),1)
            self.assertEqual(paths['output'].read_bytes(),public)

    def test_collector_makes_one_fixed_request_and_never_exports_headers(self):
        class Response:
            headers={'x-calllimit-remaining':'977','authorization':'do-not-copy'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return b'[]'
        class Opener:
            calls=[]
            def open(self,request,timeout):
                self.calls.append((request,timeout));return Response()
        opener=Opener();rows,source=publisher.fetch_source(2026,'test-only-key',opener=opener)
        self.assertEqual(len(opener.calls),1);self.assertEqual(rows,[]);self.assertEqual(source['requestCount'],1)
        request,timeout=opener.calls[0];self.assertEqual(timeout,60)
        self.assertEqual(request.full_url,'https://api.collegefootballdata.com/stats/game/advanced?year=2026&seasonType=both&excludeGarbageTime=false')
        self.assertEqual(request.get_header('Authorization'),'Bearer test-only-key')
        self.assertEqual(source['remainingCalls'],977);self.assertNotIn('authorization',json.dumps(source).lower())

    def test_collector_failure_does_not_retry_or_expose_error_details_and_redirects_fail(self):
        class Opener:
            calls=0
            def open(self,request,timeout):
                self.calls+=1;raise HTTPError(request.full_url,403,'private-provider-detail',{},None)
        opener=Opener()
        with self.assertRaises(publisher.PublicationError) as caught:
            publisher.fetch_source(2026,'test-only-key',opener=opener)
        self.assertEqual(opener.calls,1);self.assertNotIn('private-provider-detail',str(caught.exception))
        with self.assertRaises(publisher.PublicationError):
            publisher.NoRedirect().redirect_request(None,None,302,'',{},'https://elsewhere.invalid')


if __name__=='__main__':unittest.main()
