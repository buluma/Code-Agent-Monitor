# Documentation Index

An index into this repository's documentation. Each linked doc is the single
canonical source for its topic — this page does not repeat their content.

---

## Quick Links

- [Static Product Wiki](https://buluma.github.io/Code-Agent-Monitor/wiki/) -
  English product and architecture tour (GitHub Wiki is disabled for this
  repo — this GitHub Pages site is the canonical wiki)
- [Architecture Overview](../ARCHITECTURE.md) - System design and technical
  reference
- [Installation & Setup](../INSTALL.md) - Install, first run, configuration,
  and troubleshooting
- [CLI Reference](./CLI.md) - The `ccam` terminal CLI: every command, discovery,
  safety model

---

## Choose a Reading Path

Start with the smallest set of documents for the job at hand, then use the
catalog below as a reference:

| Goal                                 | Start here                                                         | Continue with                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Use or troubleshoot CCAM day to day  | [Product Wiki](https://buluma.github.io/Code-Agent-Monitor/wiki/)  | the exact references below                                                                     |
| Run CCAM locally                     | [INSTALL.md](../INSTALL.md)                                       | then the dashboard                                                                              |
| Integrate with the API or WebSocket  | [API.md](./API.md)                                                | [mcp/README.md](../mcp/README.md) for an MCP-based integration                                 |
| Understand captured activity         | [HOOKS.md](./HOOKS.md)                                             | [DATABASE.md](./DATABASE.md) and [ARCHITECTURE.md](../ARCHITECTURE.md)                          |
| Operate CCAM in production           | [DEPLOYMENT.md](../DEPLOYMENT.md)                                  | [server/README.md](../server/README.md) and [monitoring/README.md](../monitoring/README.md)    |
| Extend the UI                        | [client/README.md](../client/README.md)                           | [I18N.md](./I18N.md)                                                                            |

---

## Documentation Catalog

| Document                                              | Description                                                                                                                                                                                                                                | Audience                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [INSTALL.md](../INSTALL.md)                           | Canonical install/setup/config/troubleshooting guide                                                                                                                                                                                        | Everyone                        |
| [ARCHITECTURE.md](../ARCHITECTURE.md)                 | System design, data flow, state machines, ERD                                                                                                                                                                                                | All developers                  |
| [client/README.md](../client/README.md)               | React frontend architecture, components, state management                                                                                                                                                                                   | Frontend developers             |
| [server/README.md](../server/README.md)               | Express backend, database, WebSocket, API                                                                                                                                                                                                   | Backend developers               |
| [API.md](./API.md)                                    | REST API endpoints (sessions, agents, events, stats, analytics, hooks, pricing, workflows, settings, import history, **cc-config**, **run**), WebSocket protocol (including `run_stream` / `run_status` / `run_input_ack` for the Run page) | Integration developers           |
| [DATABASE.md](./DATABASE.md)                          | SQLite schema, queries, performance                                                                                                                                                                                                         | Database administrators          |
| [HOOKS.md](./HOOKS.md)                                | Claude Code hook system integration                                                                                                                                                                                                         | Hook developers                  |
| [mcp/README.md](../mcp/README.md)                     | MCP server setup and tool reference                                                                                                                                                                                                         | MCP integrators                  |
| [DEPLOYMENT.md](../DEPLOYMENT.md)                      | Production deployment: Docker/Podman, Kubernetes (Helm/Kustomize), Terraform, backup/restore, rollback                                                                                                                                      | DevOps engineers                 |
| [I18N.md](./I18N.md)                                  | Language architecture, locale strategy, and rollout checklist                                                                                                                                                                               | Frontend and product teams       |
| [CLI.md](./CLI.md)                                    | `ccam` command reference — monitoring, browsing, insights, alerts, pricing, import, administration                                                                                                                                          | Terminal users and CI scripting  |
| [HELMCODE-INTEGRATION.md](./HELMCODE-INTEGRATION.md)  | Spec for supporting Helm Code as a third monitored provider (ingest from `~/.helmcode/userdata/state.sqlite`) — a design/plan doc, not operator docs                                                                                        | Backend developers, reviewers    |
| [monitoring/README.md](../monitoring/README.md)       | Prometheus + Grafana stack (`npm run monitoring:up` or Docker)                                                                                                                                                                              | DevOps / observability           |

---

## Contributing

Before submitting a change:

1. Run tests: `npm test` (server `node --test` + client Vitest, including
   per-screen render snapshots — regenerate intentional UI changes with
   `cd client && npx vitest run -u`)
2. Check formatting: `npm run format:check`
3. Build: `npm run build`
4. Update docs if needed — see the doc each area's canonical file above, and
   `.claude/skills/update-project-docs/references/doc-map.md` for the full
   change-type → doc mapping this repo's agents follow

---

## Support & Resources

- **Issues:** [GitHub Issues](https://github.com/buluma/Code-Agent-Monitor/issues)
- **Discussions:** [GitHub Discussions](https://github.com/buluma/Code-Agent-Monitor/discussions)
- [Claude Code Documentation](https://docs.anthropic.com/claude/docs)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [SQLite Documentation](https://sqlite.org/docs.html)
- [React Documentation](https://react.dev/)
- [Express Documentation](https://expressjs.com/)

---

## License

This project is licensed under the MIT License. See [LICENSE](../LICENSE) for
details.
