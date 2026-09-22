# MySQL 8.0 → 8.4 (2026-09-22)

MySQL 8.0's udvidede support sluttede i april 2026. Alle tre `mysql:`-images i `docker-compose.yml` er nu `mysql:8.4`
(LTS, support til 2032): databaseserveren `mysql`, `football-db-init` (bruger kun `mysql`-klienten) og `backup`
(bruger kun `mysqldump`).

## Hvad der sker ved deploy

Første gang 8.4 starter på 8.0's datafiler, opgraderer den dem selv (dataordbog 80023 → 80300, server 80046 → 80411).
Det tog 8 s på en kopi af databasen (204 MB). **Det kan ikke rulles tilbage in-place**: 8.0 kan ikke læse 8.4's filer.
Derfor tages en kopi af volumen først.

Forudsætninger, der er tjekket: alle brugere bruger `caching_sha2_password` (8.4 har slået `mysql_native_password` fra),
der er ingen særlige serverflag i compose, og `mysql2` i backends taler 8.4 uden ændringer.

## Fremgangsmåde på serveren

```bash
# 1. Stop det, der bruger databasen, og tag en kopi af volumen (og en dump for en sikkerheds skyld)
docker compose stop backend football-backend backup
docker exec badminton-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --all-databases --single-transaction | gzip' > ~/mysql-foer-84.sql.gz
docker compose stop mysql
docker run --rm -v badminton-app_mysql_data:/from -v ~:/to alpine tar czf /to/mysql_data-8.0.tgz -C /from .

# 2. Opgradér: 8.4 starter på de samme datafiler og opgraderer dem
git pull
docker compose up -d
docker logs badminton-mysql 2>&1 | grep -E "Server upgrade|ready for connections"
```

Loggen skal vise `Server upgrade from '80046' to '80411' completed` og `Version: '8.4.11'`. Tjek derefter, at
tælleren svarer, og at `backup`-containeren laver en dump (`docker logs badminton-backup`).

## Tilbagerulning (kun hvis 8.4 ikke kommer op)

```bash
docker compose stop backend football-backend backup mysql
docker rm badminton-mysql
docker run --rm -v badminton-app_mysql_data:/data -v ~:/from alpine sh -c 'rm -rf /data/* /data/.[!.]*; tar xzf /from/mysql_data-8.0.tgz -C /data'
git checkout HEAD~1 -- docker-compose.yml     # eller ret image: tilbage til mysql:8.0
docker compose up -d
```

Afprøvet lokalt 2026-09-22: opgradering, integrationstests (30/30), backup-dump, tilbagerulning og opgradering igen.
