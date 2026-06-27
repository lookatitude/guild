---
regressions: 0
fixes: 0
flip: P->P
pass_rate_A: 1.0
pass_rate_B: 1.0
total_tokens_delta_pct: "+ (~120 tokens when autonomy=ask; 0 otherwise — additive directive)"
classification: doc-only-clarifying
trigger_change: false
algorithm_change: false
eval_case_change: false
## Flip
Single bootstrapped behavioral case. Both A and B BLOCK (correct). No flip — the edit is an ADDITIVE clarifying directive that codifies the already-valid block-on-ask-gate behavior and makes it rule-grounded. No trigger phrasing, algorithm, or eval-case change → doc-only-clarifying. Description (frontmatter) is byte-identical → shadow-mode trigger accuracy unchanged (0 divergences by construction).
