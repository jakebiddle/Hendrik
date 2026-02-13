# Entity Graph Hardening and Rollout

## Objective

Stabilize deterministic entity graph retrieval for large lorebases before wider enablement.

## Semantic Relations Rollout (Fantasy Worldbuilding)

### Canonical Contract

The rollout now supports a hybrid semantic relationship model:

1. Canonical relation arrays in frontmatter (default field: `relations`).
2. Convenience frontmatter keys (e.g., `rivalOf`, `memberOf`, `locatedIn`) mapped to canonical predicates.
3. AI/tool proposal ingestion contract (`submitSemanticRelationProposals`) that stages proposals before write.

Canonical proposal shape:

```json
{
  "notePath": "Characters/Arin.md",
  "predicate": "allied_with",
  "targetPath": "Characters/Lira.md",
  "confidence": 88,
  "sourceField": "tool:submitSemanticRelationProposals"
}
```

### Human-in-the-loop Batch Workflow

1. Generate proposals from tool outputs or explicit submission tool calls.
2. Open Semantic Batch Editor from Search Settings.
3. Review per-row origin badges and validation warnings.
4. Edit/add/remove rows.
5. Apply edited batch to frontmatter.
6. Review per-row apply report (`applied` / `skipped` / `error`) in modal.

### Current Completion Status

- [x] Semantic predicate schema and graph extraction.
- [x] Settings controls for semantic extraction + batching.
- [x] Editable batch modal with row editing.
- [x] Proposal adapter architecture.
- [x] Concrete tool-output adapter ingestion.
- [x] Explicit proposal submission tool contract (`submitSemanticRelationProposals`).
- [x] Row-level validation warnings and origin badges.
- [x] Per-row partial apply reporting.
- [x] Semantic predicate labels in entity graph relation paths.

## Automated Acceptance Gates

The rollout is blocked unless all of the following are true on CI/local verification:

1. `npm run format` passes.
2. `npm run lint` passes.
3. `npm run test` passes.
4. `npm run build` passes.
5. Entity graph regression benchmarks pass thresholds:
   1. Citation presence on answered entity queries is at least `95%`.
   2. Abstain precision on missing-evidence entity queries is at least `95%`.
   3. Contradiction rate on answered entity queries is at most `2%`.

## Manual Obsidian QA Checklist

Run this checklist in Obsidian using a lore-heavy vault.

1. Entity question with evidence:
   1. Ask an entity-centric question that should have linked evidence.
   2. Confirm answer includes inline citations.
   3. Open `SourcesModal` and confirm relation paths and evidence refs are readable.
2. Entity question without evidence:
   1. Ask a niche or unknown entity question.
   2. Confirm strict abstain response appears instead of guessing.
3. Loaded-chat continuity:
   1. Load historical chat with prior context.
   2. Ask an entity follow-up.
   3. Confirm context continuity and no unexpected loss of source grounding.
4. Relevant-notes evidence badges:
   1. Expand relevant notes list.
   2. Confirm compact graph badges show when enabled.
   3. Disable `enableEntityEvidencePanel` and confirm badges/details disappear.

## Rollout Stages

1. Stage 1: Internal dogfood only.
   1. Keep `enableEntityGraphRetrieval=false` by default.
   2. Collect internal qualitative feedback and bug reports.
2. Stage 2: Controlled default flip for new installs.
   1. Require two consecutive clean benchmark runs and manual QA pass.
   2. Keep existing kill switches active:
      1. `enableEntityGraphRetrieval`
      2. `entityGraphStrictEvidenceGate`
      3. `enableEntityEvidencePanel`
3. Stage 3: Full release-cycle observation.
   1. Monitor one full release cycle with feature enabled for new installs.
   2. Revert default quickly via settings migration if regressions exceed tolerance.
