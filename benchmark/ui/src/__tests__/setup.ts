import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Reset DOM between tests so component trees don't leak.
afterEach(() => {
  cleanup();
});
