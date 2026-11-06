"""Render the saved offline comparison as a readable report and CSV."""
import csv
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "results"
r = json.loads((OUT / "merit-comparison.json").read_text())
tables = {k: {x["id"]: x for x in r[k]} for k in ("candidate", "d1Only", "noVenue", "strongerReference")}
spans = {x["team"]: x for x in r["deletionSensitivity"]["ranges"]}
rows = []
for x in sorted(r["current"], key=lambda x: (x["colleyRank"], x["id"])):
    span = spans[x["team"]]
    rows.append(dict(team=x["team"], record=f'{x["wins"]}-{x["losses"]}', live_colley=x["colleyRank"],
                     original_sor_same_games=x["sorRank"], recalibrated_sor=tables["candidate"][x["id"]]["sorRank"],
                     original_sor_d1_only=tables["d1Only"][x["id"]]["sorRank"], oagv=x["oagvRank"],
                     reference_match_or_exceed_probability=x["tail"],
                     reference_expected_wins=x["expectedWins"],
                     sor_after_single_game_removal_min=span["sorMin"],
                     sor_after_single_game_removal_max=span["sorMax"]))
with (OUT/"all-fbs-comparison.csv").open("w",newline="",encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f,fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)

def table(items, columns):
    headings = "".join(f"<th>{html.escape(label)}</th>" for _,label in columns)
    body = "".join("<tr>"+"".join(f"<td>{html.escape(str(item[key]))}</td>" for key,_ in columns)+"</tr>" for item in items)
    return f"<div class='scroll'><table><thead><tr>{headings}</tr></thead><tbody>{body}</tbody></table></div>"

selected = [x for x in rows if x["team"] in ("Miami","Utah","Texas","BYU","UTSA","New Mexico")]
columns = [("team","Team"),("record","Record"),("live_colley","Live Colley"),
           ("original_sor_same_games","Original SOR math"),("recalibrated_sor","Recalibrated SOR")]
year_rows=[]
for year, data in r["historical"].items():
    year_rows.append(dict(year=year,games=data["originalCalibration"]["games"],
                         original=f'{data["originalCalibration"]["logLoss"]:.6f}',
                         candidate=f'{data["matchingContextCalibration"]["logLoss"]:.6f}'))
uncertainty = r["calibration"]["improvementSensitivity"]
source = "https://github.com/egemicated/vanta-cfb-intelligence/blob/149db3ac59a1cf6619df93331a9f0ef36a5be5ef/"
document = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FBS Intelligence — offline ranking research</title>
<style>body{{font:16px/1.6 system-ui,sans-serif;color:#172b40;max-width:1100px;margin:40px auto;padding:0 24px}}h1,h2{{line-height:1.2}}h2{{margin-top:36px}}.note{{padding:16px 20px;background:#edf3f8;border-left:4px solid #2672b7}}.scroll{{overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:14px}}th,td{{padding:9px 12px;border-bottom:1px solid #dbe3eb;text-align:left}}th{{background:#edf3f8}}small{{color:#526172}}a{{color:#135b94}}code{{background:#edf3f8;padding:2px 5px}}@media print{{body{{margin:0;font-size:11pt}}details{{display:block}}}}</style>
<h1>What the original mathematics adds</h1>
<p class="note"><strong>Recommendation: keep the live engine unchanged.</strong> Strength of Record is a useful comparison, but this experiment does not establish a superior replacement. No provider calls, site updates, commits, or deployments were made by these research scripts.</p>
<p>Snapshot: {html.escape(r['source']['asOf'])} (November 5, 2026, Mountain Time). This is the stored snapshot, not a new refresh. All 138 FBS teams are compared using the same stored results. Original SOR means the pinned original formula and frozen parameters applied to our data; it does not reproduce the original site's distinct data snapshot.</p>
<h2>The result that matters most</h2>
<p>Applying the original Strength of Record mathematics to the same game network moves UTSA from #16 to #12. Restricting that calculation to FBS/FCS games puts UTSA #13. It remains a Top 25 team in this experiment. Neither formula uses conference prestige.</p>
{table(selected,columns)}
<p>The original SOR math estimates an average-rated FBS reference team has about a 3.4% chance of matching UTSA's seven wins on that eight-game schedule. Texas's six-win total has about a 4.2% matching probability on its harder schedule. That difference puts UTSA higher in this particular SOR model. These are model estimates, not verified real-world odds.</p>
<h2>What is being compared</h2>
<ul><li><strong>Live Colley:</strong> the current outcome-only achievement ranking, reproduced to within {r['source']['reconstructedColleyMaxError']:.2g} from the published evidence. All 138 records and ranks matched.</li>
<li><strong>Original SOR math:</strong> remove the evaluated game occurrence; recompute opponent rating and the average FBS reference rating; apply frozen slope 4.2967562254 and home log-odds 0.4745547195; calculate the probability of at least the actual win total using the Poisson-binomial distribution. Lower probability means higher achievement.</li>
<li><strong>Recalibrated SOR:</strong> same formula, but fit the probability conversion on the same final-season, excluded-game context used by SOR. Training used {r['trainingGames']:,} FBS-vs-FBS games from 2014–2019. Resulting slope {r['matchingContextParameters'][0]:.6f}; home log-odds {r['matchingContextParameters'][1]:.6f}. This is an experimental alternative, not a selected model.</li>
<li><strong>D1-only:</strong> original parameters with FBS/FCS games only: {r['d1Coverage']['games']:,} games and {r['d1Coverage']['teams']} teams, versus the current full graph's {r['source']['games']:,} games and {r['source']['teams']} teams. This isolates population sensitivity.</li></ul>
<h2>Did recalibration improve the original?</h2>
<p>Only slightly overall, and not consistently. On 2,398 retrospective excluded-game observations from 2023–2025, log loss fell from {r['calibration']['original']['logLoss']:.6f} to {r['calibration']['matchingContext']['logLoss']:.6f} (about 0.20%; lower is better). Brier score fell from {r['calibration']['original']['brier']:.6f} to {r['calibration']['matchingContext']['brier']:.6f}.</p>
{table(year_rows,[("year","Season"),("games","Games"),("original","Original log loss"),("candidate","Recalibrated log loss")])}
<p>It worsened in 2024. A paired season-week resampling check (2,000 draws across {uncertainty['blocks']} blocks) gave a descriptive 95% range for the log-loss reduction of {uncertainty['pairedSeasonWeekResamplingRange95'][0]:.6f} to {uncertainty['pairedSeasonWeekResamplingRange95'][1]:.6f}, spanning zero. That provides no clear basis to declare a win. Parameters were held fixed and teams cross week blocks, so this is a limited sensitivity check.</p>
<p><strong>These are not pregame forecasts.</strong> Each target game is excluded, but other games from its season remain visible, including later games. These numbers must not be compared with the live predictive engine's historical forecast accuracy. Better probability fit also does not prove a better achievement ranking. The evaluation seasons were previously inspected during engine development.</p>
<h2>What could strengthen our system</h2>
<ul><li><strong>Clearer achievement explanations:</strong> SOR puts the difficulty of a complete record into an understandable question. OAGV provides a separate expected-wins comparison; its additive game values are not an exact decomposition of SOR.</li>
<li><strong>Exact removal of the evaluated game:</strong> limits direct circular credit in schedule evaluation. The analytic calculation was checked against full refits, including a repeated matchup.</li>
<li><strong>Visible sensitivity:</strong> all {r['deletionSensitivity']['games']} FBS-involving games were removed one at a time and rankings recalculated. UTSA stayed in the Top 25 in every such trial, ranging #6–#21 under original SOR. Those are deletion sensitivity results, not confidence bounds or a Top 25 probability.</li>
<li><strong>Separate calibration from opinion:</strong> the newer probability conversion changes Texas from #15 to #9 and UTSA from #12 to #16, but those more familiar-looking positions are not evidence of correctness.</li></ul>
<h2>Limits and next decision</h2>
<p>Twenty-three of the current Top 25 also appear in the original-math SOR Top 25. SOR and Colley ask different questions, so rank changes alone are not improvements. Venue and the reference-team definition matter. The reference is an average rating, not the average probability over all FBS teams. SOR assumes independent games conditional on estimated probabilities; it excludes margins and does not fully quantify model uncertainty.</p>
<p>Historic lower-division coverage varies; the 2014–2019 archive omits postseason. Current opponent classifications include unknowns. No AP or Coaches Poll data was loaded, and no poll agreement was calculated or used as a tuning target. The original week's research against polls has not been independently reproduced here.</p>
<p><strong>Decision:</strong> retain current production rankings. Keep original-parameter SOR as an offline comparison. The recalibration has not earned promotion. Further work should first verify data coverage and compare behavior at repeated historical weekly cutoffs, then preserve genuinely future observations before choosing a replacement. Assess margin-cap changes separately in the predictive model.</p>
<h2>Full comparison</h2><p>Original SOR math is evaluated on the full current graph here. D1-only and the other sensitivity variants are in the JSON. Rank ranges and expected wins are available in the CSV.</p>
{table(rows,columns+[("original_sor_d1_only","D1-only SOR"),("oagv","OAGV")])}
<h2>Reproduce and inspect</h2><p>Run <code>python research/compare_merit.py</code>, then <code>python research/write_report.py</code> from the project folder, using Python with NumPy installed. No secrets or network access are required. The scripts only write research/results. Existing engine tests: 21 passed.</p>
<p><a href="all-fbs-comparison.csv">Download all-team CSV</a> · <a href="merit-comparison.json">Detailed results and input hashes</a></p>
<p>Original source: <a href="{source}docs/MERIT-V2-REMEDIATED-METHODOLOGY.md">remediated methodology</a> · <a href="{source}docs/MERIT-V2-METHODOLOGY.md">original specification</a> · <a href="{source}src/vanta_cfb/merit_v2.py">implementation</a>. Pinned commit: 149db3ac59a1cf6619df93331a9f0ef36a5be5ef.</p>
<small>Research snapshot hash: {r['source']['snapshotHash']}. The stored snapshot's paired contribution fields reconstruct outcome edges and venue uniquely under its documented strength transform. No synthetic scores or dates were introduced.</small></html>"""
(OUT/"comparison.html").write_text(document,encoding="utf-8")
print("Wrote comparison.html and all-fbs-comparison.csv")
