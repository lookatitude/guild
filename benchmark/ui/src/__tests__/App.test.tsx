import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { installMockFetch } from "./fixtures/mockFetch";

function mount(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
}

describe("App — routing shell", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("renders the primary nav with all four links", () => {
    handle = installMockFetch();
    mount(["/"]);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Runs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compare" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Trigger" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Demo" })).toBeInTheDocument();
  });

  it("renders the unknown-route fallback for an unmatched path", () => {
    handle = installMockFetch();
    mount(["/no-such-route"]);
    expect(screen.getByText(/Unknown route/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to runs/ })).toBeInTheDocument();
  });
});
