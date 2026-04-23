# Cockpit Integration Handoff

This page is the starter contract for AG lane work after `wiki-mint` PR merge.

## Goal

Connect `wiki-mint` output into the SIH Cockpit so generated showcases appear as verified wiki assets with a visible `minted` badge and a durable Supabase audit trail.

## Current state in `sih-core`

The Phase 2 AG artifacts identify Cockpit integration as a high-priority follow-up. A separate read-only inspection of the current `sih-core` working copy found that integration is partially present already:

- `docs/wiki/BUILD_SHOWCASE.md` exists.
- `style.css` already defines `.badge--mint`.
- `app.js` already detects minted wiki assets.
- mock assets already include a minted `BUILD_SHOWCASE.md` row.
- Supabase insert paths already exist.

## Main issue to fix

`app.js` appears to have duplicate `registerMintedAsset()` definitions in the inspected working copy.

The next implementation should **not** add a third path. It should consolidate one canonical public hook:

```js
SIH.registerMintedAsset({
  title: 'BUILD_SHOWCASE.md',
  projectId: 'a0000000-0000-0000-0000-000000000001',
  agentId: 'antigravity',
  format: 'readme-showcase',
  source: 'docs/wiki/Build-Registry.md',
  entryCount: 5
})
```

## Expected asset payload

```js
{
  title: 'BUILD_SHOWCASE.md',
  asset_type: 'wiki',
  agent_id: agentId || CONFIG.agent,
  status: 'verified',
  metadata: {
    minted: true,
    format,
    source,
    entryCount,
    mintedAt
  },
  project_id: projectId
}
```

## Badge behavior

Keep `.badge badge--mint` as the visual signal.

Canonical detection should prefer:

```js
asset.asset_type === 'wiki' && asset.metadata?.minted === true
```

The title fallback `BUILD_SHOWCASE.md` can stay for legacy/mock data, but new records should rely on metadata.

## Supabase strategy

The current schema supports this asset type:

- `asset_type = 'wiki'`
- `agent_id = 'antigravity' | 'codex' | 'hermes' | 'human'`
- `status = 'verified'`
- `metadata` stores mint details

Implementation should be idempotent:

1. look for an existing minted wiki asset by project, title, and source
2. update metadata/status if found
3. insert if not found
4. add an explicit `audit_trail` `verify` event
5. refresh the dashboard

## Verification checklist

Minimum verification:

```powershell
node --check app.js
```

Manual browser verification:

1. load `index.html`
2. confirm `BUILD_SHOWCASE.md` appears
3. confirm `minted` badge appears with `badge--mint`
4. call `SIH.registerMintedAsset(...)`
5. confirm no duplicate rows on repeated calls

Supabase verification:

```sql
select title, asset_type, status, metadata
from knowledge_assets
where title = 'BUILD_SHOWCASE.md';

select action_type, reason
from audit_trail
where asset_id = '<new asset id>'
order by event_at desc;
```

## Risks

- Current dev grants may allow broad anon writes; production should use RLS, RPC, Edge Function, or a service-side writer.
- Existing seed/mock data may contain stale `entryCount` values and should be verified during implementation.
- Browser inserts may not set `app.current_agent`; explicit audit insert is needed for attribution.
