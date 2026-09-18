# Seed data dump

`federation.dump` is a `pg_dump` custom-format archive of the local dev
database's seeded/simulated data (learning tracks, client nodes, network
overview, activity events, agent assessments). No real patient data — this
is demo telemetry, per [docs/production-readiness.md](../../../docs/production-readiness.md).

## Restore into a local Postgres

```bash
docker run -d -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=federation -p 15432:5432 postgres:16-alpine
docker cp federation.dump <container-name>:/tmp/federation.dump
docker exec <container-name> pg_restore -U postgres -d federation --no-owner /tmp/federation.dump
```

Regenerate this dump after seed changes with:

```bash
docker exec <container-name> pg_dump -U postgres -d federation --no-owner --no-privileges -F c -f /tmp/federation.dump
docker cp <container-name>:/tmp/federation.dump lib/db/seed-data/federation.dump
```
