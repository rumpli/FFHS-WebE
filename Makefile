# Makefile

.PHONY: build down up all client backend

down:
	docker compose down

up:
	docker compose build client backend --no-cache
	docker compose up -d

all: up client backend

build:
	docker compose build client backend --no-cache

client:
	docker compose build client
	docker compose up client --watch &

backend:
	docker compose build backend
	docker compose up backend --watch &

test:
	npm --prefix server run test

smoke:
	npm --prefix server run smoke