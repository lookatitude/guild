/**
 * src/modules/dispatch/workflows/specialist-contract.ts
 *
 * Minimal specialist routing contract shared by dispatch and capability routing.
 */

export interface SpecialistDispatchContract {
  name: string;
  scope: string;
  dependsOn: string[];
}
