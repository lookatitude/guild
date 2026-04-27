import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_RUN_STATUSES,
  StatusPill,
} from "../components/StatusPill";

describe("StatusPill — four-pills contract", () => {
  afterEach(() => {
    // cleanup runs from setup.ts; explicit re-import not needed.
  });

  it("renders one pill for every RunStatus value", () => {
    expect(ALL_RUN_STATUSES).toEqual(["pass", "fail", "timeout", "errored"]);
    for (const status of ALL_RUN_STATUSES) {
      const { unmount } = render(<StatusPill status={status} />);
      const pill = screen.getByLabelText(`status: ${status}`);
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveAttribute("data-status", status);
      expect(pill).toHaveTextContent(status);
      unmount();
    }
  });

  it("uses span.pill class so global.css can target it", () => {
    render(<StatusPill status="pass" />);
    const pill = screen.getByLabelText("status: pass");
    expect(pill.tagName.toLowerCase()).toBe("span");
    expect(pill).toHaveClass("pill");
  });
});
