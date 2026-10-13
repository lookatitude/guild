/**
 * Composition-root binding for the ports a domain names but must not implement
 * (KTD4: a domain never imports src/adapters). An entry point that needs host
 * runtime calls `bindHostRuntimePorts()` once before it runs domain code; an
 * unbound port fails closed inside the domain.
 */

import { installHostAdapterConformanceOwner } from "../domains/distribution";
import {
  evaluateMh03HostAdapterConformance,
  type Mh03ConformanceRequest,
} from "./host-adapter-conformance-evaluator";

export function bindHostRuntimePorts(): void {
  installHostAdapterConformanceOwner((request) =>
    evaluateMh03HostAdapterConformance(request as unknown as Mh03ConformanceRequest),
  );
}
