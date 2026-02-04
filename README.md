# FFHS-WebE

[![License](https://img.shields.io/badge/License-GPL--v3.0-lightgrey)](https://github.com/rumpli/FFHS-LinAlg/blob/main/LICENSE)
![Code](https://img.shields.io/badge/Language-HTML-green)
![Code](https://img.shields.io/badge/Language-CSS-blue)
![Code](https://img.shields.io/badge/Language-JavaScript-yellow)
![Code](https://img.shields.io/badge/Language-Typecript-blue)

-----

Table of Contents
=================
* [What is this about?](#what-is-this-about)
* [Evaluation and grade](#evaluation-and-grade)
* [More FFHS projects](#more-ffhs-projects)

-----

### What is this about?
This project is the semester work from the "Web Engineering" module at the FFHS (HS25/26). All code was written with WebStorm.

### Evaluation and grade

Points: 54/50

Grade: 6.0

### More FFHS projects

FFHS directory: [MyCloud](https://www.mycloud.ch/s/S00735653476C6FF89DAE1C9D6F19C814A0FE9C6DC2)

![image](https://github.com/rumpli/FFHS-AnPy/assets/24840091/5c56fb5b-944a-40a3-b5c8-1972850dc7a2)

FFHS projects: [GitHub](https://github.com/rumpli?tab=repositories&q=FFHS&type=&language=&sort=)


# Documentation
[Documentation](docs/documentation.md)

# Anleitung

## Aufbau
```console
.
├── client
│   ├── public
│   │   ├── assets
│   │   └── audio
│   ├── src
│   │   ├── auth
│   │   ├── components
│   │   ├── core
│   │   ├── net
│   │   ├── screens
│   │   ├── state
│   │   └── ui
│   └── styles
│       ├── components
│       └── responsive
├── docs
│   └── img
├── infra
│   └── grafana
│       ├── dashboards
│       ├── datasources
│       └── provisioning
├── server
│   ├── prisma
│   ├── scripts
│   ├── src
│   │   ├── auth
│   │   ├── db
│   │   ├── diagnostics
│   │   ├── http
│   │   ├── match
│   │   ├── observability
│   │   ├── schemas
│   │   ├── sim
│   │   └── ws
│   └── tests
└── shared
    ├── protocol
    │   └── types
    └── types
```

## Installation
Siehe Abschnitt "Start".

## Voraussetzungen
Docker und Docker Compose müssen installiert sein.

### Versionen
- Docker: 29.1.3 oder höher
- Docker Compose: v2.40.3-desktop.1 oder höher

Verifiziert auf macOS 26.2.

## Start
Es steht ein `Makefile` zur Verfügung, welche die nachfolgenden manuellen Schritte im Kapitel "Build" und "Tests und Simulation" automatisiert.

### Makefile Befehle
Starten des Projekts mit:
```shell
make up
```

Stoppen des Projekts mit:
```shell
make down
```

Testen des Backends mit:
```shell
make test
```

Smoke Tests des Backends mit:
```shell
make smoke
```

Container bauen mit:
```shell
make build
```

#### Development Modus
Im "Development Modus" werden Quellcode-Änderungen automatisch erkannt innerhalb des Frontends und Backends mithilfe der `docker compose --watch` Funktion.
Dies ermöglicht ein schnelleres Feedback während der Entwicklung. Jedoch werden die Logs auf der Konsole ausgegeben.

Starten des Projekts im Development Modus mit:
```shell
make all
```
Stoppen des Projekts im Development Modus mit:
```shell
make down
```

Client:
```shell
make client
```

Backend:
```shell
make backend
```

Welche Dateien eine Änderung auslösen, ist im `docker-compose.yml` definiert.
```yaml
services:
    client:
      develop:
        watch: []
      backend:
        watch: []
```

### Build
```shell
docker compose build --no-cache
```

```console
[+] Building 2/2
✔ group05-backend  Built                                                                                                                                                                0.0s
✔ group05-client   Built
```

### Run
```shell
docker compose up -d
```

```console
[+] Running 10/10
 ✔ Container group05-db-1              Healthy                                                                                                                                           5.6s
 ✔ Container group05-redis-1           Healthy                                                                                                                                           5.6s
 ✔ Container group05-tempo-1           Started                                                                                                                                           0.1s
 ✔ Container group05-loki-1            Started                                                                                                                                           0.1s
 ✔ Container group05-otel-collector-1  Started                                                                                                                                           0.3s
 ✔ Container group05-promtail-1        Started                                                                                                                                           0.1s
 ✔ Container group05-backend-1         Started                                                                                                                                           0.1s
 ✔ Container group05-prometheus-1      Started                                                                                                                                           0.1s
 ✔ Container group05-client-1          Started                                                                                                                                           0.1s
 ✔ Container group05-grafana-1         Started                                                                                                                                           0.1s
```

### Zugriff
- Frontend: http://localhost:5173 oder über http://local-ip:5173 (das Spiel ist innerhalb des LAN erreichbar, vorausgesetzt die Firewall erlaubt den Zugriff)

### Grafana
- Grafana: http://localhost:3000 (Benutzer: admin, Passwort: admin)

#### Dashboards
- Top Cards / Cards Played: [Dashboard](http://localhost:3000/goto/df8kl7q0qtfy8f?orgId=1)
- Open Matches & Lobbies: [Dashboard](http://localhost:3000/goto/cf8kltj829n9ce?orgId=1)
- Match Duration and Deck Usage: [Dashboard](http://localhost:3000/goto/bf8klvr3cw000f?orgId=1)
- Backend Logs: [Dashboard](http://localhost:3000/goto/ef8klxlz70f7kb?orgId=1)

mehr unter Drilldown.

#### Drilldown
Unter Drilldown können die Logs, Metriken und Traces eingesehen werden.

### Zugriff auf Services
- Backend: http://localhost:8080
- Prometheus: http://localhost:9090
- Loki: http://localhost:3100
- Tempo: http://localhost:3200
- Redis: localhost:6379
- Datenbank: localhost:5432
- OpenTelemetry Collector: localhost:4317
- Promtail: localhost:9080

## Stop
```shell
docker compose down
```

```console
[+] Running 11/11
 ✔ Container group05-client-1          Removed                                                                                                                                           0.5s
 ✔ Container group05-otel-collector-1  Removed                                                                                                                                           0.3s
 ✔ Container group05-promtail-1        Removed                                                                                                                                           0.4s
 ✔ Container group05-grafana-1         Removed                                                                                                                                           0.4s
 ✔ Container group05-loki-1            Removed                                                                                                                                          10.3s
 ✔ Container group05-prometheus-1      Removed                                                                                                                                           0.2s
 ✔ Container group05-tempo-1           Removed                                                                                                                                          10.3s
 ✔ Container group05-backend-1         Removed                                                                                                                                           0.2s
 ✔ Container group05-db-1              Removed                                                                                                                                           0.2s
 ✔ Container group05-redis-1           Removed                                                                                                                                           0.3s
 ✔ Network group05_default             Removed                                                                                                                                           0.2s
```

## Shared Code & Docker Compose Build Strategy

Dieses Projekt ist als Monorepo aufgebaut und beinhaltet neben `client/` und `server/` auch einen gemeinsamen `shared/`-Bereich für wiederverwendbare Typen und Protokolle:

```text
client/
server/
shared/
  ├── protocol/
  │   └── types/
  └── types/
```

### Gemeinsame Typen

Sowohl das Backend als auch das Frontend verwenden gemeinsame TypeScript-Typen aus `shared/`, z.B. für Match- und WebSocket-Protokolle:

- Backend (z.B. `server/src/ws/matchState.ts`):
  - `import { MatchPlayerState, MatchPhase, MatchStateSnapshot, ... } from "../../../shared/protocol/types/match.js";`
- Frontend (z.B. `client/src/core/match-ws-handler.ts`):
  - `import { WsMatchStateMsg, WsBattleUpdateMsg, ... } from "../../../shared/protocol/types/match.js";`

Dadurch bleibt das Protokoll zwischen Client und Server typsicher und konsistent.

### Docker Compose Build

Damit `shared/` sowohl im Client- als auch im Server-Docker-Image zur Verfügung steht, verwendet `docker-compose.yml` jeweils das Repository-Root als Build-Context und verweist explizit auf die entsprechenden Dockerfiles:

```yaml
services:
  backend:
    build:
      context: .
      dockerfile: ./server/Dockerfile
  client:
    build:
      context: .
      dockerfile: ./client/Dockerfile
```

Die Dockerfiles spiegeln dieses Layout und kopieren `client/`, `server/` und `shared/` relativ zum Repo-Root:

- `client/Dockerfile` (vereinfacht):
  - `COPY client/package*.json ./`
  - `COPY client/ ./`
  - `COPY shared/ ../shared`
- `server/Dockerfile` (vereinfacht):
  - `COPY server/package*.json ./`
  - `COPY server/ ./`
  - `COPY shared/ ../shared`

**Wichtig:**
- Die Builds werden immer aus dem Repository-Root gestartet (z.B. via `docker compose build`).
- Dadurch sind `client/`, `server/` und `shared/` alle Teil des Build-Contexts und können innerhalb der Dockerfiles per `COPY` verwendet werden.

## Tests und Simulation

Diese Tests und Simulationen sind für das Backend implementiert.

Für alle Tests und Smoke Tests kann der folgende Befehl verwendet werden:
```
npm --prefix server run ci
```

Dieser Befehl führt `smoke` und `test` nacheinander aus.

### Smoke Tests
Smoke Tests können mit dem folgenden Befehl ausgeführt werden:
```shell
npm --prefix server run smoke
```

### Alle Tests
Alle Tests können mit dem folgenden Befehl ausgeführt werden:
```shell
npm --prefix server run test
```

### Einzelne Tests

#### Smoke Simulation
Um eine einfache Kampfsimulation durchzuführen, kann das folgende Skript verwendet werden:
```shell
npm --prefix server run smoke:simulation:ts
```

Innerhalb des Scripts können Parameter angepasst werden, wie beispielsweise die Anzahl der Ticks oder Anzahl der 'Gegner'.

#### Smoke Round End
Um eine einfache Kampfrunde zu simulieren, kann das folgende Skript verwendet werden:
```shell
npm --prefix server run smoke:round-end:ts
```

#### Smoke Goal Raid
Um einen einfachen Goblin-Raid zu simulieren, kann das folgende Skript verwendet werden:
```shell
npm --prefix server run smoke:goblin-raid:ts
```

### Debug Logs

#### Client
Um Debug-Logs im Frontend zu aktivieren, kann die Umgebungsvariable `VITE_LOG_DEBUG` auf `1` in der `client/.env` Datei gesetzt werden:

```
VITE_LOG_DEBUG=1
```

#### Backend

Um Debug-Logs im Backend zu aktivieren, kann die Umgebungsvariable `LOG_DEBUG` auf `1` in der `server/.env` Datei gesetzt werden:

```
LOG_DEBUG=1
```

### Runde beenden
Um den Clients zu erlauben, eine Runde frühzeitig zu beenden, muss die Umgebungsvariable `ALLOW_CLIENT_END_ROUND` auf `1` in der `server/.env` und `VITE_ALLOW_CLIENT_END_ROUND` in `client/.env` Datei gesetzt werden:

```
ALLOW_CLIENT_END_ROUND=1
```

```
VITE_ALLOW_CLIENT_END_ROUND=1
```
