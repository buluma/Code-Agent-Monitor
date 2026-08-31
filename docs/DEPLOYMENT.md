# Deployment

Moved to [`/DEPLOYMENT.md`](../DEPLOYMENT.md) at the repo root — that is the
canonical deployment doc (Docker/Podman, Kubernetes via Helm/Kustomize,
Terraform, backup/restore, rollback, production checklist).

Example Kustomize image substitution from that guide:

```bash
kubectl kustomize deployments/kubernetes/overlays/production \
  | sed "s|cam-dashboard:4.0.1|${REGISTRY}/claude-code-agent-monitor:${IMAGE_TAG}|g" \
  | kubectl apply --server-side --field-manager=cam-deployer -f -
```
