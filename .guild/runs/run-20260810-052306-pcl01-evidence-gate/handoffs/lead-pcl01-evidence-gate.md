# Lead handoff — PCL-01 deterministic evidence gate

- Run: `run-20260810-052306-pcl01-evidence-gate`
- Initiative: `project-capability-localization`
- Work item: `PCL-01`
- Current phase: closed

Implemented a fourth, file-bound D8 condition over `close_gate.evidence` and
every work-item `evidence_refs` entry. The checker rejects missing, malformed,
absolute, traversal, prose, directory, unreadable, and symlink-escaping
references. Source and bundled module resources were regenerated.

Focused verification: 4 suites, 118 tests passed. Inventory regeneration and
inventory check passed. A clean `origin/next` re-run separately passed 4 suites
and 424 tests, while preserving the truthful 5-of-31 conformance boundary.

The final frozen patch cleared the cross-family review in round 3 with no
blocking findings. `verify-gate-pass` confirmed all five conditions: parse,
packet ID, artifact SHA-256, satisfied verdict, and zero blockers. The final
reviewed artifact SHA-256 is
`ea750c318b5b8e7e9cdcbd3be7d23488bdb8f203bf956310a3134dd434441009`.
