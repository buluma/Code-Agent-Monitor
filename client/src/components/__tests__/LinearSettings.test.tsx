/**
 * @file Regression tests for the Settings page Linear API key panel: shows
 * configured state, saves a new key, and clears an existing one.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinearSettings } from "../LinearSettings";

const getConfigMock = vi.fn();
const setConfigMock = vi.fn();
const clearConfigMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    linear: {
      getConfig: (...args: unknown[]) => getConfigMock(...args),
      setConfig: (...args: unknown[]) => setConfigMock(...args),
      clearConfig: (...args: unknown[]) => clearConfigMock(...args),
    },
  },
}));

beforeEach(() => {
  getConfigMock.mockReset();
  setConfigMock.mockReset();
  clearConfigMock.mockReset();
});

describe("LinearSettings", () => {
  it("saves a new API key", async () => {
    getConfigMock.mockResolvedValue({ configured: false });
    setConfigMock.mockResolvedValue({ configured: true });

    render(<LinearSettings />);

    const input = await screen.findByPlaceholderText(/linear personal api key/i);
    fireEvent.change(input, { target: { value: "lin_api_abc" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(setConfigMock).toHaveBeenCalledWith("lin_api_abc"));
    expect(await screen.findByText(/api key configured/i)).toBeInTheDocument();
  });

  it("clears a configured API key", async () => {
    getConfigMock.mockResolvedValue({ configured: true });
    clearConfigMock.mockResolvedValue({ configured: false });

    render(<LinearSettings />);

    expect(await screen.findByText(/api key configured/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));

    await waitFor(() => expect(clearConfigMock).toHaveBeenCalled());
    expect(screen.queryByText(/api key configured/i)).not.toBeInTheDocument();
  });
});
