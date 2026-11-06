"""Raw-stat identities, missingness, denominators and non-human inputs."""
import copy
import csv
import io
import json
import unittest
from pathlib import Path
from performance_ingest import normalize_row,normalize_season,StatError,OUTPUT,CACHE,sha

def row(team='1',home='home'):
    return dict(firstDowns='20',thirdDownEff='4-10',fourthDownEff='1-1',totalYards='350',netPassingYards='200',
        completionAttempts='18/30',yardsPerPass='6.7',rushingYards='150',rushingAttempts='40',yardsPerRushAttempt='3.8',
        totalPenaltiesYards='4-35',turnovers='2',fumblesLost='1',interceptions='1',possessionTime='30:00',
        team_id=team,team_name='Ignored source display name',team_abbreviation='IGN',home_away=home,game_id='101',season='2025')

def context(neutral=False):
    return {'teams':{'1':{'id':'1','name':'A','division':'fbs','conference':'X'},'2':{'id':'2','name':'B','division':'fbs','conference':'Y'},
        '3':{'id':'3','name':'C','division':'fcs','conference':'Z'}},
        'games':{'101':{'id':'101','home':'1','away':'2','neutral':neutral,'startDate':'2025-11-01T18:00:00Z','week':10,
            'seasonType':'regular','homePoints':21,'awayPoints':14,'finalMargin':7,'homeAwayKnown':True}},'source':{'kind':'fixture'}}

def table(rows):
    out=io.StringIO();keys=list(dict.fromkeys(k for r in rows for k in r));writer=csv.DictWriter(out,fieldnames=keys);writer.writeheader();writer.writerows(rows);return out.getvalue()

class PerformanceIngestTests(unittest.TestCase):
    def test_plays_are_pass_plus_rush_without_double_counting_sacks(self):
        raw=row();raw['sacks']='99';raw['yardsPerPass']='999';stat=normalize_row(raw)
        self.assertEqual(stat['plays'],70);self.assertEqual(stat['yards'],350);self.assertEqual(stat['yardsPerPlay'],5.)
        self.assertNotIn('sacks',stat);self.assertNotIn('yardsPerPass',stat)
    def test_missing_optional_fields_remain_null_and_required_values_fail(self):
        raw=row();raw['turnovers']='';raw['possessionTime']='NA';stat=normalize_row(raw)
        self.assertIsNone(stat['turnovers']);self.assertIsNone(stat['possessionSeconds'])
        raw['rushingAttempts']=''
        with self.assertRaisesRegex(StatError,'missing-rushingAttempts'):normalize_row(raw)
    def test_sacks_can_produce_negative_rushing_yards_but_not_negative_attempts(self):
        raw=row();raw['rushingYards']='-10';raw['totalYards']='190'
        self.assertEqual(normalize_row(raw)['rushingYards'],-10)
        raw['rushingAttempts']='-1'
        with self.assertRaises(StatError):normalize_row(raw)
    def test_component_and_fraction_inconsistencies_fail(self):
        for field,value in [('totalYards','351'),('completionAttempts','31/30'),('thirdDownEff','11-10'),
            ('fourthDownEff','2-1'),('turnovers','3'),('possessionTime','30:60')]:
            raw=row();raw[field]=value
            with self.subTest(field=field),self.assertRaises(StatError):normalize_row(raw)
    def test_zero_pass_attempts_valid_only_with_zero_passing_yards(self):
        raw=row();raw['completionAttempts']='0/0'
        with self.assertRaisesRegex(StatError,'passing-yards-without-attempts'):normalize_row(raw)
        raw['netPassingYards']='0';raw['totalYards']='150'
        self.assertEqual(normalize_row(raw)['plays'],40)
    def test_game_team_pairing_is_order_independent_and_metadata_comes_from_outcomes(self):
        rr=[row(),row('2','away')];before=copy.deepcopy(rr)
        first=normalize_season(table(rr),2025,context());second=normalize_season(table(rr[::-1]),2025,context())
        self.assertEqual(first,second);self.assertEqual(rr,before)
        g=first['games'][0];self.assertEqual((g['home'],g['away'],g['homePoints'],g['awayPoints']),('1','2',21,14))
        self.assertEqual(g['startDate'],'2025-11-01T18:00:00Z');self.assertEqual(g['stats']['home']['plays'],70)
    def test_one_bad_or_missing_side_excludes_the_entire_game(self):
        rr=[row(),row('2','away')];rr[1]['totalYards']=''
        normalized=normalize_season(table(rr),2025,context())
        self.assertEqual(normalized['games'],[]);self.assertEqual(normalized['audit']['exclusionReasons'],{'missing-yards':1})
        self.assertEqual(normalized['audit']['teamCoverage']['1']['statGames'],0)
    def test_duplicate_team_rows_and_mismatched_participants_are_not_joined_by_name(self):
        for rr in ([row(),row('2','away'),row('2','away')],[row(),row('3','away')]):
            self.assertEqual(normalize_season(table(rr),2025,context())['games'],[])
    def test_neutral_orientation_can_reverse_but_non_neutral_orientation_cannot(self):
        rr=[row('1','away'),row('2','home')]
        self.assertEqual(normalize_season(table(rr),2025,context())['games'],[])
        accepted=normalize_season(table(rr),2025,context(True))
        self.assertEqual(len(accepted['games']),1);self.assertEqual(accepted['audit']['neutralOrientationDifferences'],['101'])
    def test_wrong_source_season_and_unidentified_game_are_rejected(self):
        rr=[row(),row('2','away')];rr[1]['season']='2026'
        with self.assertRaisesRegex(StatError,'wrong-source-season'):normalize_season(table(rr),2025,context())
        rr=[row(),row('2','away')];rr[0]['game_id']='unknown'
        with self.assertRaisesRegex(StatError,'invalid-game_id'):normalize_season(table(rr),2025,context())
    def test_human_and_source_model_fields_do_not_affect_normalized_inputs(self):
        plain=[row(),row('2','away')];poisoned=copy.deepcopy(plain)
        for r in poisoned:r.update(ap_poll='1',fpi='100',elo='9999',home_win_probability='1.0',epa='900',adj_qbr='100')
        self.assertEqual(normalize_season(table(plain),2025,context()),normalize_season(table(poisoned),2025,context()))
    @unittest.skipUnless((OUTPUT/'manifest.json').exists(),'Local normalized research data not built')
    def test_written_dataset_and_raw_sources_match_manifest_checksums(self):
        manifest=json.loads((OUTPUT/'manifest.json').read_text())
        for year,entry in manifest['seasons'].items():
            self.assertEqual(sha((OUTPUT/f'seasons/{year}.json').read_bytes()),entry['sha256'])
            self.assertEqual(sha((CACHE/f'team_box_{year}.csv').read_bytes()),entry['rawSourceSha256'])
        current=json.loads((OUTPUT/'seasons/2026.json').read_text())
        self.assertTrue(all(g['startDate'] is None and g['homePoints'] is None and g['week'] is None for g in current['games']))

if __name__=='__main__':unittest.main()
