"""Recorded-count reconstruction, missingness and exact-identity safeguards."""
import copy
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest

from predictive_v2_ingest import FEATURES, InputError, load_year, normalize_season, parse_stats


def row(team='1', home='home', game='100'):
    return dict(firstDowns='20', thirdDownEff='5-10', fourthDownEff='0-0', totalYards='350',
                netPassingYards='200', completionAttempts='12/20', rushingYards='150', rushingAttempts='30',
                totalPenaltiesYards='5-50', turnovers='2', fumblesLost='1', interceptions='1',
                possessionTime='30:00', team_id=team, team_name='Ignored source display name',
                home_away=home, game_id=game, season='2024')


def text(rows):
    stream = io.StringIO(); names = sorted(set().union(*(entry.keys() for entry in rows)))
    writer = csv.DictWriter(stream, fieldnames=names); writer.writeheader(); writer.writerows(rows)
    return stream.getvalue()


def parent(neutral=False):
    def game(identity, home, away, completed=True):
        return dict(id=identity, home=home, away=away, homePoints=28 if completed else None,
                    awayPoints=14 if completed else None, completed=completed, neutral=neutral,
                    startDate='2024-09-01T12:00:00Z', week=1, seasonType='regular')
    return dict(year=2024, teams=[dict(id='1', name='A', division='fbs'), dict(id='2', name='B', division='fcs'),
                                dict(id='3', name='C', division='fbs'), dict(id='4', name='D', division='ii')],
                games=[game('100','1','2'), game('101','2','3'), game('102','1','4'), game('103','1','3',False)])


class CountInputTests(unittest.TestCase):
    def test_rebuilds_rates_from_counts_and_carries_denominators(self):
        result = parse_stats(row()); metrics = result['features']
        self.assertEqual(result['raw']['plays'],50)
        self.assertEqual(metrics['ypp'],7.)
        self.assertEqual(metrics['passingYpp'],10.)
        self.assertEqual(metrics['rushingYpp'],5.)
        self.assertEqual(metrics['completionRate'],.6)
        self.assertEqual(metrics['firstDownRate'],.4)
        self.assertEqual(metrics['thirdDownRate'],.5)
        self.assertEqual(metrics['turnoverRate'],.04)
        self.assertEqual(metrics['penaltyYardsPerPlay'],1.)
        self.assertEqual(result['denominators']['thirdDownRate'],10)
        self.assertEqual(result['raw']['possessionSeconds'],1800)

    def test_zero_opportunities_are_unavailable_not_zero(self):
        result = parse_stats(row())
        self.assertIsNone(result['features']['fourthDownRate'])
        self.assertEqual(result['denominators']['fourthDownRate'],0)
        self.assertEqual(result['issues']['fourthDownRate'],'zero-opportunities')

    def test_a_missing_field_preserves_independent_metrics(self):
        entry = row(); entry['completionAttempts'] = 'NA'
        result = parse_stats(entry)
        self.assertIsNone(result['features']['ypp'])
        self.assertIsNone(result['features']['completionRate'])
        self.assertEqual(result['features']['rushingYpp'],5.)
        self.assertEqual(result['features']['thirdDownRate'],.5)
        self.assertIsNone(result['denominators']['ypp'])

    def test_contradictory_yards_and_turnovers_do_not_become_features(self):
        entry=row(); entry.update(totalYards='999',turnovers='4')
        result=parse_stats(entry)
        self.assertTrue(all(result['features'][name] is None for name in ('ypp','passingYpp','rushingYpp','turnoverRate')))
        self.assertEqual(result['features']['completionRate'],.6)
        self.assertEqual(result['features']['penaltyYardsPerPlay'],1.)

    def test_signed_college_yards_preserve_sack_accounting(self):
        entry=row(); entry.update(totalYards='190',netPassingYards='200',rushingYards='-10',yardsPerRushAttempt='99',sacks='15')
        result=parse_stats(entry)
        self.assertEqual(result['features']['ypp'],190/50)
        self.assertEqual(result['features']['rushingYpp'],-10/30)
        self.assertNotIn('sacks',result['raw'])

    def test_invalid_numerators_and_integer_fields_are_isolated(self):
        entry=row(); entry.update(completionAttempts='21/20',thirdDownEff='11-10',fourthDownEff='bad',firstDowns='2.5')
        result=parse_stats(entry)
        for name in ('completionRate','thirdDownRate','fourthDownRate','firstDownRate'):
            self.assertIsNone(result['features'][name])
        self.assertEqual(result['features']['ypp'],7.)

    def test_keeps_entire_completed_parent_outcome_universe(self):
        result=normalize_season(text([row(),row('2','away')]),2024,parent())
        self.assertEqual(len(result['games']),3)
        self.assertIsNotNone(result['games'][0]['stats'])
        self.assertIsNone(result['games'][1]['stats'])
        self.assertIsNone(result['games'][2]['stats'])
        self.assertFalse(result['games'][2]['knownD1'])
        self.assertEqual(result['audit']['expectedFbsGames'],2)
        self.assertEqual(result['audit']['featureCoverage']['ypp']['pairedFbsGames'],1)
        self.assertEqual(result['audit']['featureCoverage']['fourthDownRate']['pairedFbsGames'],0)
        self.assertEqual(result['audit']['featureCoverage']['ypp']['missingFbsGameIds'],['101'])

    def test_duplicate_participant_and_venue_mismatch_are_not_guessed(self):
        mutations=[lambda rows:rows.append(copy.deepcopy(rows[0])),
                   lambda rows:rows[1].update(team_id='3'),
                   lambda rows:rows[0].update(home_away='away')]
        for mutate in mutations:
            rows=[row(),row('2','away')]; mutate(rows)
            result=normalize_season(text(rows),2024,parent())
            self.assertIsNone(result['games'][0]['stats'])

    def test_neutral_orientation_and_input_order_do_not_change_identity_attached_counts(self):
        rows=[row('1','away'),row('2','home')];rows[0]['firstDowns']='18'
        a=normalize_season(text(rows),2024,parent(True))
        b=normalize_season(text(list(reversed(rows))),2024,parent(True))
        self.assertEqual(a['games'],b['games'])
        self.assertEqual(a['games'][0]['stats']['home']['features']['firstDownRate'],18/50)
        self.assertEqual(a['audit']['neutralOrientationDifferences'],['100'])

    def test_provider_derived_fields_names_and_future_boxes_do_not_enter_features(self):
        rows=[row(),row('2','away')]
        a=normalize_season(text(rows),2024,parent())
        for entry in rows:
            entry.update(ppa='999',successRate='.99',yardsPerPass='99',pollRank='1',team_name='Changed')
        rows.extend([row('1','home','103'),row('3','away','103')])
        b=normalize_season(text(rows),2024,parent())
        self.assertEqual(a['games'],b['games'])
        self.assertIn('103',b['audit']['sourceGameIdsOutsideCompletedParent'])

    def test_wrong_season_or_missing_parent_timing_halts_instead_of_backfilling(self):
        wrong=row();wrong['season']='2025'
        with self.assertRaises(InputError):normalize_season(text([wrong]),2024,parent())
        broken=parent();broken['games'][0]['startDate']=None
        with self.assertRaises(InputError):normalize_season(text([row(),row('2','away')]),2024,broken)
        for year in (2020,2021,2022,2026):
            with self.assertRaises(InputError):load_year(year)

    def test_source_checksum_is_required_before_loading_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary); data=text([row(),row('2','away')]).encode()
            (directory/'team_box_2024.csv').write_bytes(data)
            manifest=dict(provider='fixture recorded counts',files=[dict(year=2024,name='team_box_2024.csv',sha256='0'*64,bytes=len(data))])
            (directory/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            with self.assertRaisesRegex(InputError,'checksum'):
                load_year(2024,cache_dir=directory,parent_dir=directory)


if __name__ == '__main__':
    unittest.main()
