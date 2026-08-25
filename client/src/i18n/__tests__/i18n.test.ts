/**
 * @file i18n.test.ts
 * @description Unit tests for i18n translation resources to ensure correct translations and locale handling in the agent dashboard application.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { describe, it, expect } from "vitest";
import i18n from "i18next";

const flattenResource = (
  value: unknown,
  prefix = "",
  result: Record<string, unknown> = {}
): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenResource(child, prefix ? `${prefix}.${key}` : key, result);
    }
  } else {
    result[prefix] = value;
  }

  return result;
};

const interpolationTokens = (value: unknown): string[] => {
  if (typeof value !== "string") return [];

  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}|%\{\s*([^}\s]+)\s*\}/g)]
    .flatMap((match) => {
      const token = match[1] ?? match[2];
      return token ? [token] : [];
    })
    .sort();
};

describe("i18n resources", () => {
  it("keeps every namespace's keys, value types, and interpolation tokens aligned", () => {
    const namespaces = Object.keys(i18n.getDataByLanguage("en") ?? {});

    for (const namespace of namespaces) {
      const english = flattenResource(i18n.getResourceBundle("en", namespace));

      for (const key of Object.keys(english)) {
        expect(typeof english[key], `en/${namespace}:${key} type`).toBeDefined();
        expect(
          interpolationTokens(english[key]),
          `en/${namespace}:${key} interpolation tokens`
        ).toBeDefined();
      }
    }
  });

  it("should provide English translations for navigation keys", async () => {
    await i18n.changeLanguage("en");

    expect(i18n.t("nav:dashboard")).toBe("Dashboard");
    expect(i18n.t("nav:agentBoard")).toBe("Kanban Board");
  });

  it("pluralizes the subagent count labels in English", async () => {
    await i18n.changeLanguage("en");
    // The collapsed agent-tree badge (Dashboard) and SessionDetail both render
    // this key with a count. It MUST use i18next plural forms (_one/_other) so
    // "2 subagent" never shows — the flat common:subagent word is not a plural
    // key and rendering it with a count is the bug this guards against.
    expect(i18n.t("common:subagent_label", { count: 1 })).toBe("1 subagent");
    expect(i18n.t("common:subagent_label", { count: 2 })).toBe("2 subagents");
    // The main-agent card subtitle carries its own kanban plural key.
    expect(i18n.t("kanban:session.subagentSummary", { count: 1 })).toBe("1 subagent");
    expect(i18n.t("kanban:session.subagentSummary", { count: 3 })).toBe("3 subagents");
  });

  it("pluralizes task-progress counts in English", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("sessions:taskProgress.more", { count: 1 })).toBe(
      "+1 more task in Session Detail"
    );
    expect(i18n.t("sessions:taskProgress.more", { count: 2 })).toBe(
      "+2 more tasks in Session Detail"
    );
    expect(i18n.t("sessions:taskProgress.hiddenTasks", { count: 1 })).toBe(
      "1 additional task is not shown."
    );
    expect(i18n.t("sessions:taskProgress.hiddenTasks", { count: 2 })).toBe(
      "2 additional tasks are not shown."
    );
  });

  it("ships every first-run hook setup control in English", () => {
    const keys = [
      "provider.both.label",
      "provider.both.description",
      "hookGate.kicker",
      "hookGate.title",
      "hookGate.description",
      "hookGate.selectedProviders",
      "hookGate.realTime",
      "hookGate.checking",
      "hookGate.installed",
      "hookGate.existing",
      "hookGate.ready",
      "hookGate.overrideWarning",
      "hookGate.output",
      "hookGate.failure",
      "hookGate.checkFailed",
      "hookGate.preserveNote",
      "hookGate.alreadyInstalled",
      "hookGate.install",
      "hookGate.installing",
      "hookGate.continue",
    ];

    for (const key of keys) {
      expect(i18n.getResource("en", "splash", key)).toBeTruthy();
    }
  });

  it("ships the global provider and session-home settings in English", () => {
    const keys = [
      "display.title",
      "display.claude",
      "display.codex",
      "display.both",
      "display.claudeDescription",
      "display.codexDescription",
      "display.bothDescription",
      "homes.title",
      "codexHome.title",
      "pricing.navClaude",
      "pricing.navGpt",
      "pricing.gpt.title",
      "pricing.gpt.tooltip.title",
      "pricing.gpt.tooltip.howItWorksBody",
      "pricing.gpt.tooltip.apiPricingBody",
    ];

    for (const key of keys) {
      expect(i18n.getResource("en", "settings", key)).toBeTruthy();
    }
  });
});
