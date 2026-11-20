# Operation Full Court architecture

The local development branch starts at `120bb7651f4583a4ccffb73aff33e409acda009a`. Render confirmed that revision as the live football deployment at baseline. The current worktree and preview are local. No branch is published and the preview server listens on loopback.

| Classification | Scope |
| --- | --- |
| Reuse directly | Existing GD logo, local font assets, CSS tokens, branded football static build, Node dependency lock, protected build and test commands, and public audit evidence. |
| Reuse by interface | Competition-qualified identities, shell and sport navigation, team identity cards, tables, score and forecast presentation, conference exploration, data cutoffs, and immutable model report concepts. |
| Keep football-specific | Engine and configuration, SHA-protected publication contract, divisional calibration, saved forecasts, SOR scenarios, existing clean routes, production workflows, contest records, and access policies. |
| Implement for basketball | Provider client and private cache, league registry, venue/possession-aware models, day-based scores, basketball forecasts and evidence, conference matrix, 68/76-team brackets and retrospective evaluation. |

The private build consumes normalized basketball input from the ignored data cache. The local HTTP server renders limited game views and model outputs by route. It never serves the source cache. Basketball identifiers are qualified by `ncaam-d1`. Football uses its original routes under the same local preview, with the old home made available at `/football/`. Production router and release workflows do not import these preview modules.

Production Supabase stores football-specific picks, bracket entries and favorites behind protected RPCs and row-level controls. The account UI includes separate Google/PKCE, password, recovery and administrator MFA routes. No production data, configuration, credentials or policies are pulled into basketball practice profiles. The project needs a sport-qualified ownership policy and staged live-auth integration before release.
