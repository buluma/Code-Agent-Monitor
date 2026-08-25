/**
 * @file Sidebar.test.tsx
 * @description Unit tests for the Sidebar component, which is responsible for rendering the application's sidebar navigation. The tests cover rendering of the brand name, subtitle, navigation links, WebSocket connection status, and version number. The tests use React Testing Library and Vitest for assertions and mocking.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { beforeEach, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Sidebar } from "../Sidebar";
import i18n from "../../i18n";

function renderSidebar(wsConnected: boolean, collapsed = false) {
  return render(
    <MemoryRouter>
      <Sidebar wsConnected={wsConnected} collapsed={collapsed} onToggle={() => {}} />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("should render the brand name", () => {
    renderSidebar(true);
    expect(screen.getByText("Agent Dashboard")).toBeInTheDocument();
  });

  it("should render the subtitle", () => {
    renderSidebar(true);
    expect(screen.getByText("Claude Code Monitor")).toBeInTheDocument();
  });

  it("should render all navigation links", () => {
    renderSidebar(true);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Kanban Board")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Activity Feed")).toBeInTheDocument();
  });

  it('should show "Live" when WebSocket is connected', () => {
    renderSidebar(true);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it('should show "Disconnected" when WebSocket is not connected', () => {
    renderSidebar(false);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("should show version number", () => {
    // `__APP_VERSION__` is injected by Vite from the repo-root package.json
    // (see vite.config.ts) and replaced at transform time in tests too, so this
    // stays correct as the project version changes.
    renderSidebar(true);
    expect(screen.getByText(`v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it("should have correct navigation hrefs", () => {
    renderSidebar(true);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/kanban");
    expect(hrefs).toContain("/sessions");
    expect(hrefs).toContain("/activity");
  });
});
