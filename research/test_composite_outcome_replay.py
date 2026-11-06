"""Meaningful parity and no-future checks for the offline composite adapter."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import numpy as np

from composite_outcome_replay import ROOT, compute_checkpoint, replay
from test_research import fixture


CONFIG = json.loads((ROOT / 'data/model.json').read_bytes())
PARAMETERS = json.loads((ROOT / 'data/publication-model.json').read_bytes())['parameters']


class CompositeOutcomeReplayChecks(unittest.TestCase):
    def test_production_node_parity_including_prior_ot_neutral_and_fcs(self):
        data = fixture(); data['teams'][-1]['division'] = 'fcs'
        data['games'][0]['regulationMargin'] = 0
        previous = dict(season=2023, ratings=[dict(id=str(i), strength=(i - 1) * 3.1) for i in range(4)])
        fitted = compute_checkpoint(data, data['games'], previous, CONFIG, PARAMETERS)['rows']
        script = """
import {rankSeason} from './src/engine.js';
import {calculateDivisionSor} from './research/lib/division_candidate.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const {data,previous,config,parameters}=JSON.parse(input);
const snapshot=rankSeason(data,{previous,config});
const outcome={teams:data.teams,games:data.games.map(g=>({id:g.id,a:g.home,b:g.away,
  outcome:Math.sign(g.homePoints-g.awayPoints),venue:g.neutral?0:1}))};
console.log(JSON.stringify({strength:snapshot.ratings,sor:calculateDivisionSor(outcome,parameters).rows}));
"""
        result = subprocess.run([shutil.which('node'), '--input-type=module', '-e', script],
            input=json.dumps(dict(data=data, previous=previous, config=CONFIG, parameters=PARAMETERS)),
            text=True, capture_output=True, cwd=ROOT, check=True)
        node = json.loads(result.stdout)
        strength = {row['id']: row for row in node['strength']}
        sor = {row['id']: row for row in node['sor']}
        for identity, row in fitted.items():
            self.assertAlmostEqual(row['strength'], strength[identity]['strength'], places=10)
            self.assertAlmostEqual(row['colley'], strength[identity]['achievement'], places=11)
            self.assertAlmostEqual(row['sor'], sor[identity]['sor'], places=10)
            self.assertEqual(row['games'], strength[identity]['games'])

    def test_target_and_later_outcome_isolation(self):
        data = fixture(); altered = copy.deepcopy(data)
        altered['games'][2]['homePoints'] = 100
        original = replay(data, None, CONFIG, PARAMETERS, include_final=True)
        changed = replay(altered, None, CONFIG, PARAMETERS, include_final=True)
        self.assertEqual(original[1]['rows'], changed[1]['rows'])
        self.assertEqual(original[1]['eligibleGameIds'], ['g1','g2'])
        self.assertNotEqual(original[-1]['rows'], changed[-1]['rows'])

    def test_strength_history_does_not_enter_sor(self):
        data = fixture()
        prior = dict(season=2023, ratings=[dict(id=str(i), strength=(i - 1) * 4) for i in range(4)])
        a = compute_checkpoint(data, data['games'], None, CONFIG, PARAMETERS)['rows']
        b = compute_checkpoint(data, data['games'], prior, CONFIG, PARAMETERS)['rows']
        self.assertTrue(any(a[i]['strength'] != b[i]['strength'] for i in a))
        self.assertEqual({i:a[i]['sor'] for i in a}, {i:b[i]['sor'] for i in b})

    def test_no_same_year_strength_prior(self):
        data = fixture()
        with self.assertRaises(ValueError):
            compute_checkpoint(data, [], dict(season=2024, ratings=[]), CONFIG, PARAMETERS)

    def test_empty_graph_keeps_sor_unearned_and_strength_prior_only(self):
        data = fixture(); prior = dict(season=2023, ratings=[dict(id='0', strength=8.)])
        fitted = compute_checkpoint(data, [], prior, CONFIG, PARAMETERS)['rows']
        self.assertTrue(all(row['games'] == 0 and row['sor'] == 0 for row in fitted.values()))
        self.assertEqual(fitted['0']['strength'], 8 * CONFIG['retention'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
