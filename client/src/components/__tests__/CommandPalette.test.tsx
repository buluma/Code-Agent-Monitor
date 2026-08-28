/**
 * @file Regression tests for the command palette (Cmd+K / Ctrl+K jump-to
 * overlay): the shortcut toggles it open/closed, static nav results filter by
 * query, session search only fires past the minimum query length, and
 * selecting a result navigates and closes the palette.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { CommandPalette } from "../CommandPalette";
import type { Session } from "../../lib/types";

const listMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    sessions: {
      list: (...args: unknown[]) => listMock(...args),
    },
  },
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-abc123",
    name: "Fix desktop freeze",
    status: "active",
    cwd: "/Users/dev/project",
    model: "claude-opus-4-8",
    started_at: "2026-08-02T00:00:00.000Z",
    ended_at: null,
    metadata: null,
    agent_count: 1,
    provider: "claude",
    ...overrides,
  };
}

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ sessions: [], total: 0, limit: 8, offset: 0 });
});

describe("CommandPalette", () => {
  it("is closed until the keyboard shortcut opens it", () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    );
    expect(screen.queryByPlaceholderText(/search sessions and pages/i)).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText(/search sessions and pages/i)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    );
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(/search sessions and pages/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/search sessions and pages/i)).not.toBeInTheDocument();
  });

  it("filters the static nav results by query", () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    );
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search sessions and pages/i), {
      target: { value: "settings" },
    });

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Analytics")).not.toBeInTheDocument();
  });

  it("does not search sessions below the minimum query length", () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    );
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.change(screen.getByPlaceholderText(/search sessions and pages/i), {
      target: { value: "f" },
    });

    expect(listMock).not.toHaveBeenCalled();
  });

  it("searches and lists matching sessions past the minimum query length", async () => {
    listMock.mockResolvedValue({
      sessions: [makeSession()],
      total: 1,
      limit: 8,
      offset: 0,
    });

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    );
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.change(screen.getByPlaceholderText(/search sessions and pages/i), {
      target: { value: "fix" },
    });

    await waitFor(() => expect(listMock).toHaveBeenCalledWith({ q: "fix", limit: 8 }));
    await waitFor(() => expect(screen.getByText("Fix desktop freeze")).toBeInTheDocument());
  });

  it("navigates to the selected session and closes on click", async () => {
    listMock.mockResolvedValue({
      sessions: [makeSession()],
      total: 1,
      limit: 8,
      offset: 0,
    });

    render(
      <MemoryRouter>
        <LocationProbe />
        <CommandPalette />
      </MemoryRouter>
    );
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.change(screen.getByPlaceholderText(/search sessions and pages/i), {
      target: { value: "fix" },
    });

    const result = await screen.findByText("Fix desktop freeze");
    fireEvent.click(result);

    expect(screen.getByTestId("location")).toHaveTextContent("/sessions/sess-abc123");
    expect(screen.queryByPlaceholderText(/search sessions and pages/i)).not.toBeInTheDocument();
  });
});
