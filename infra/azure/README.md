# Azure infrastructure

Bicep template provisioning the coordinator API and web dashboard as Azure
Container Apps for a single pilot environment. Validated with the standalone
Bicep CLI (`bicep build main.bicep`, `bicep build-params main.bicepparam`) —
both compile cleanly — but **has not been deployed against a real Azure
subscription**. Review it before running against production.

## What this provisions

| Resource | Purpose |
|---|---|
| Container Apps Environment | Shared runtime for both container apps |
| Container App `<prefix><env>-api` | Coordinator API (this repo's `artifacts/api-server`) |
| Container App `<prefix><env>-web` | Web dashboard (this repo's `artifacts/federated-imaging-network`) |
| Container Registry (Basic) | Stores built images; CI pushes here |
| User-assigned managed identity | Lets both container apps pull from ACR and read Key Vault secrets without embedding credentials |
| Key Vault | Holds `postgres-admin-password`, `clerk-secret-key`, and `agent-api-key` |
| Postgres Flexible Server (Burstable B1ms) | Real data — see "Postgres is now real" below |
| Log Analytics + Application Insights | Container Apps logs and API telemetry |

## Postgres is now real, not a placeholder

The federation API (`artifacts/api-server/src/routes/federation.ts`) reads
and writes through `@workspace/db` (Drizzle) — tracks, client nodes, network
overview, activity events, and agent assessments/history are real tables,
not in-memory state. After provisioning this template, run once against the
new database:

```bash
export DATABASE_URL="postgresql://<admin>@<postgres-fqdn>:5432/federation?sslmode=require"
pnpm --filter @workspace/db run push   # creates tables
pnpm --filter @workspace/db run seed   # inserts starter tracks/nodes/events/assessments
```

The seed script is idempotent — it checks whether `learning_tracks` already
has rows and skips if so, so it's safe to run again after a deploy.

## The agent is real, and needs a model-provider key

`POST /network/agent/assessments` (`artifacts/api-server/src/lib/agent.ts`)
makes a real tool-use call to an OpenAI-compatible chat completions API —
Groq by default (`openai/gpt-oss-120b`), configurable via
`GROQ_BASE_URL`/`AGENT_MODEL` for any other OpenAI-compatible provider,
including Azure OpenAI. This has been verified live: given real seeded data,
the model correctly queried the network overview, node list, and event log
tools before producing a schema-valid Action Value Card. It needs a real
API key (`agentApiKey` parameter / `AGENT_API_KEY` env var below) to do
anything — without one, the endpoint fails with a clear, typed error rather
than falling back to fake data.

## First-time deployment

```bash
az group create --name fedimg-dev-rg --location eastus

export PG_ADMIN_PASSWORD="<generate a strong password>"
export CLERK_SECRET_KEY="<from your Clerk dashboard>"
export AGENT_API_KEY="<a Groq key, or any OpenAI-compatible provider key>"

az deployment group create \
  --resource-group fedimg-dev-rg \
  --template-file main.bicep \
  --parameters main.bicepparam
```

The first deployment uses placeholder images
(`mcr.microsoft.com/k8se/quickstart`) for both container apps, since the
registry is empty before CI has pushed anything. After the deployment
succeeds, either:

- run the `Deploy to Azure` GitHub Actions workflow (see below), or
- push images manually and run `az containerapp update --image ...` for
  both `<prefix><env>-api` and `<prefix><env>-web`.

## Wiring up `.github/workflows/deploy-azure.yml`

That workflow authenticates via OIDC (no long-lived client secret). To set
it up:

1. Create an Entra ID app registration and a federated credential scoped to
   this repo + branch (`az ad app create`, `az ad app federated-credential create`).
2. Grant that app's service principal `AcrPush` on the registry and
   `Contributor` (or a narrower custom role) on the resource group.
3. Add these repository secrets (`Settings → Secrets and variables → Actions`,
   scoped to the `dev`/`staging`/`prod` environment as appropriate):
   - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
   - `AZURE_ACR_NAME` (registry name, without `.azurecr.io`)
   - `AZURE_RESOURCE_GROUP`
   - `AZURE_RESOURCE_PREFIX` (i.e. `<namePrefix><environmentName>`, e.g. `fedimgdev`)
   - `CLERK_PUBLISHABLE_KEY`
4. The workflow is `workflow_dispatch`-only until you're ready for every
   merge to `main` to auto-deploy — switch its trigger to a `push` block
   once that's actually wanted.

## Manual steps this template does not automate

- **Custom domain + TLS** — bind a domain to each Container App's ingress
  and provision a managed certificate after the first deployment.
- **Clerk production instance** — this template passes through whatever
  Clerk publishable/secret key you give it; switching from a Clerk
  development instance to a production one is a Clerk dashboard action,
  not an infrastructure one.
- **Entra ID as an auth provider** — the product spec's long-term plan is
  Microsoft Entra ID for identity; this migration keeps Clerk as-is. Swapping
  auth providers is a separate, larger change to `artifacts/api-server/src/middlewares`
  and the frontend's Clerk provider, not something this template does.
- **Database schema + migrations** — see the gap above.
- **Separate dev/staging/prod environments** — deploy this template into
  separate resource groups per environment (different `environmentName`
  parameter values) rather than adding environment branching to the template.
