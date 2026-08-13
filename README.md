# shophub-api

ShopHub platform API — **spec 1.2 (Upravljanje sajtovima prodavnica)**.

This is the backend the ShopHub admin panel calls to create, configure and delete
shop sites. Each shop is modelled as three linked Kubernetes custom resources
owned by the [shop-operator](../shop-operator):

```
Shop ──walletRef──────────▶ Wallet
     └─discordChannelRef──▶ DiscordChannel
```

The service is **stateless** — there is no database. All shop state lives in the
cluster as `Shop`, `Wallet` and `DiscordChannel` CRs
(`shophub.devops-siit.io/v1`). Users are isolated by an owner label derived from
their user id, so a caller only ever sees and mutates their own shops.

## Authentication

Every `/shops` route requires a Bearer **access token issued by
[shophub-auth-service](../shophub-auth-service)**. This service validates the
token locally using the same `JWT_ACCESS_SECRET`, so the two secrets must match.

## API

| Method | Path           | Description                                            |
| ------ | -------------- | ----------------------------------------------------- |
| POST   | `/shops`       | Create a shop (+ its Wallet and DiscordChannel CRs)   |
| GET    | `/shops`       | List the caller's shops                               |
| GET    | `/shops/:name` | Get one shop                                          |
| PATCH  | `/shops/:name` | Reconfigure availability / display name / wallet addr |
| DELETE | `/shops/:name` | Delete the shop and its owned CRs                     |
| GET    | `/health`      | Liveness/readiness probe                              |

Swagger UI is served at `/api/docs`.

### Create payload

```jsonc
{
  "name": "Healthy Food Store",   // display name
  "availability": "standard",      // standard (2 replicas) | high (3)
  "databaseType": "standard",      // standard (PostgreSQL/CNPG) | light (Redis)
  "walletAddress": "0x1234...",    // receives customer payments
  "discordChannelName": "orders",  // notifications channel
  "discordServerId": "123456789"   // Discord guild id
}
```

The `databaseType` is immutable after creation (switching it would require
migrating the shop's data), so `PATCH` only accepts `name`, `availability` and
`walletAddress`.

## Local development

```bash
cp .env.example .env      # set JWT_ACCESS_SECRET to match the auth service
npm install
npm run start:dev
```

The Kubernetes client uses your default kubeconfig (`~/.kube/config` or
`$KUBECONFIG`) when run outside a pod, so point your kube-context at the local
kind cluster and make sure the shop-operator CRDs are installed and the
`SHOP_NAMESPACE` (default `shophub-shops`) exists:

```bash
kubectl create namespace shophub-shops
```

## Tests

```bash
npm test          # unit tests (shops service/controller)
npm run test:e2e  # HTTP integration test against an in-memory fake cluster
```

The e2e test boots the full Nest app and exercises the create → list → update →
delete flow, overriding the Kubernetes client with an in-memory stand-in so it
runs in CI without a real API server.

## Known limitation — wallet address

The teammate-owned `WalletSpec` currently exposes only `shopRef` (the on-chain
address is produced by the operator and surfaced in `status.address`). Spec 1.2
lets the admin supply a wallet address, so until `WalletSpec` gains an `address`
field this service stores the admin-provided address as the
`shophub.devops-siit.io/wallet-address` annotation on both the Shop and Wallet
CRs.

## Container

Built and published by the `Release` workflow on push to `main`
(`<dockerhub-user>/shophub-api`). Deployed via
[`helm-charts/charts/shophub`](../helm-charts/charts/shophub); RBAC for the CRDs
lives in that chart.
