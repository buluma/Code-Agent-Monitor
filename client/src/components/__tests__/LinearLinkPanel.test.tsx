/**
 * @file Regression tests for the Session Detail Linear link panel: the
 * unconfigured pointer to Settings, linking by pasted URL, auto-detecting
 * from the branch, and unlinking.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LinearLinkPanel } from "../LinearLinkPanel";
import type { LinearLink } from "../../lib/api";

const getConfigMock = vi.fn();
const getLinkMock = vi.fn();
const linkMock = vi.fn();
const unlinkMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    linear: {
      getConfig: (...args: unknown[]) => getConfigMock(...args),
      getLink: (...args: unknown[]) => getLinkMock(...args),
      link: (...args: unknown[]) => linkMock(...args),
      unlink: (...args: unknown[]) => unlinkMock(...args),
    },
  },
}));

const SAMPLE_LINK: LinearLink = {
  session_id: "sess-1",
  issue_id: "issue-uuid",
  identifier: "ENG-123",
  title: "Fix the thing",
  url: "https://linear.app/acme/issue/ENG-123/fix-the-thing",
  state: "In Progress",
  source: "url",
  linked_at: "2026-08-02T00:00:00.000Z",
  synced_at: "2026-08-02T00:00:00.000Z",
};

beforeEach(() => {
  getConfigMock.mockReset();
  getLinkMock.mockReset();
  linkMock.mockReset();
  unlinkMock.mockReset();
});

describe("LinearLinkPanel", () => {
  it("points to Settings when no API key is configured", async () => {
    getConfigMock.mockResolvedValue({ configured: false });
    getLinkMock.mockResolvedValue({ link: null });

    render(
      <MemoryRouter>
        <LinearLinkPanel sessionId="sess-1" />
      </MemoryRouter>
    );

    expect(await screen.findByText(/isn't connected/i)).toBeInTheDocument();
  });

  it("shows a paste-URL form and links on submit", async () => {
    getConfigMock.mockResolvedValue({ configured: true });
    getLinkMock.mockResolvedValue({ link: null });
    linkMock.mockResolvedValue({ link: SAMPLE_LINK });

    render(
      <MemoryRouter>
        <LinearLinkPanel sessionId="sess-1" />
      </MemoryRouter>
    );

    const input = await screen.findByPlaceholderText(/paste a linear issue url/i);
    fireEvent.change(input, {
      target: { value: "https://linear.app/acme/issue/ENG-123/fix-the-thing" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    await waitFor(() =>
      expect(linkMock).toHaveBeenCalledWith("sess-1", {
        url: "https://linear.app/acme/issue/ENG-123/fix-the-thing",
      })
    );
    expect(await screen.findByText("ENG-123")).toBeInTheDocument();
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
  });

  it("auto-detects from the branch on button click", async () => {
    getConfigMock.mockResolvedValue({ configured: true });
    getLinkMock.mockResolvedValue({ link: null });
    linkMock.mockResolvedValue({ link: SAMPLE_LINK });

    render(
      <MemoryRouter>
        <LinearLinkPanel sessionId="sess-1" />
      </MemoryRouter>
    );

    const autoButton = await screen.findByRole("button", { name: /detect from branch/i });
    fireEvent.click(autoButton);

    await waitFor(() => expect(linkMock).toHaveBeenCalledWith("sess-1", { auto: true }));
  });

  it("shows the linked issue and unlinks on click", async () => {
    getConfigMock.mockResolvedValue({ configured: true });
    getLinkMock.mockResolvedValue({ link: SAMPLE_LINK });
    unlinkMock.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <LinearLinkPanel sessionId="sess-1" />
      </MemoryRouter>
    );

    expect(await screen.findByText("ENG-123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unlink/i }));

    await waitFor(() => expect(unlinkMock).toHaveBeenCalledWith("sess-1"));
    expect(await screen.findByPlaceholderText(/paste a linear issue url/i)).toBeInTheDocument();
  });
});
