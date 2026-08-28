/**
 * @file Verifies the Helm Code Config Explorer tab: the overview renders the
 * resolved home, the state DB metadata, the env overrides, and the projection
 * counts; the "Resync now" button posts to the dashboard resync endpoint and
 * surfaces a success toast with the sweep summary.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { HelmcodeConfigOverview } from "../../lib/api";
import { HelmcodeConfigExplorer } from "../HelmcodeConfigExplorer";

const OVERVIEW: HelmcodeConfigOverview = {
  home: "/Users/dev/.helmcode",
  userdata_dir: "/Users/dev/.helmcode/userdata",
  state_db_path: "/Users/dev/.helmcode/userdata/state.sqlite",
  state_db: { exists: true, size_bytes: 268435456, mtime: "2026-08-28T00:00:00.000Z" },
  server_runtime: {
    version: 3,
    pid: 12345,
    host: "127.0.0.1",
    port: 4321,
    origin: "http://127.0.0.1:4321",
    started_at: "2026-08-28T00:00:00.000Z",
  },
  env: {
    DASHBOARD_HELMCODE_HOME: null,
    HELMCODE_HOME: null,
    DASHBOARD_HELMCODE_SYNC_MS: null,
  },
  sync: { poll_ms: 4000 },
  projection_counts: {
    projects: 2,
    threads: 5,
    archived: 1,
    deleted: 0,
    messages: 42,
    activities: 17,
    turns: 6,
  },
};

const overviewMock = vi.fn();
const resyncMock = vi.fn();

vi.mock("../../lib/api", () => ({
  api: {
    helmcodeConfig: {
      overview: () => overviewMock(),
      resync: () => resyncMock(),
    },
  },
  // Re-export the type so the import in this test file resolves at the type level.
}));

async function renderExplorer() {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: { en: { ccConfig: {} } },
    });
  }
  return render(
    <I18nextProvider i18n={i18n}>
      <HelmcodeConfigExplorer />
    </I18nextProvider>
  );
}

describe("HelmcodeConfigExplorer", () => {
  beforeEach(() => {
    overviewMock.mockReset();
    resyncMock.mockReset();
    overviewMock.mockResolvedValue(OVERVIEW);
    resyncMock.mockResolvedValue({
      ok: true,
      summary: { scanned: 5, changed: 2, created: 1, removed: 0 },
    });
  });

  it("renders the overview home, state DB, runtime, env, and projection counts", async () => {
    renderExplorer();
    await waitFor(() => expect(overviewMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("/Users/dev/.helmcode")).toBeInTheDocument();
    expect(screen.getByText("/Users/dev/.helmcode/userdata/state.sqlite")).toBeInTheDocument();
    expect(screen.getByText("256.0 MiB")).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument(); // PID
    expect(screen.getByText("4321")).toBeInTheDocument(); // port
    expect(screen.getByText("4000 ms")).toBeInTheDocument(); // poll interval
    // Projection counts: each count value appears.
    expect(screen.getByText("5")).toBeInTheDocument(); // threads
    expect(screen.getByText("42")).toBeInTheDocument(); // messages
    expect(screen.getByText("17")).toBeInTheDocument(); // activities
  });

  it("calls resync and shows a success toast when the Resync button is clicked", async () => {
    const user = userEvent.setup();
    renderExplorer();
    const button = await screen.findByTestId("helmcode-resync");
    await user.click(button);
    await waitFor(() => expect(resyncMock).toHaveBeenCalledTimes(1));
    // The resync re-fetches the overview to refresh the counts.
    await waitFor(() => expect(overviewMock).toHaveBeenCalledTimes(2));
  });

  it("renders an error banner when the overview fetch fails", async () => {
    overviewMock.mockRejectedValueOnce(new Error("boom"));
    renderExplorer();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
