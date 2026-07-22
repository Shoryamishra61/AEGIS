#!/usr/bin/env bash
# AEGIS database bootstrap: run migrations + seed inside a postgres-client container.
# Idempotent: schema_migrations guards re-application of numbered migrations.
set -euo pipefail

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=aegis}"
: "${POSTGRES_USER:=aegis_admin}"
: "${POSTGRES_PASSWORD:=aegis_admin_pw}"
: "${GATEWAY_DB_USER:=aegis_gateway}"
: "${GATEWAY_DB_PASSWORD:=aegis_gateway_pw}"
: "${CONTROL_DB_USER:=aegis_control}"
: "${CONTROL_DB_PASSWORD:=aegis_control_pw}"
: "${AUDIT_READER_DB_USER:=aegis_audit_reader}"
: "${AUDIT_READER_DB_PASSWORD:=aegis_audit_reader_pw}"

export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL="psql -v ON_ERROR_STOP=1 -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB"

echo "[db-bootstrap] waiting for postgres at $POSTGRES_HOST:$POSTGRES_PORT ..."
until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" >/dev/null 2>&1; do
    sleep 1
done
echo "[db-bootstrap] postgres is ready"

applied() {
    # returns 0 if migration version already applied
    local v="$1"
    local out
    out=$($PSQL -tAc "SELECT 1 FROM schema_migrations WHERE version='$v'" 2>/dev/null || true)
    [ "$out" = "1" ]
}

table_exists() {
    local out
    out=$($PSQL -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL" 2>/dev/null || true)
    [ "$out" = "t" ]
}

run_migration() {
    local file="$1"
    local version
    version="$(basename "$file" .sql)"
    if table_exists && applied "$version"; then
        echo "[db-bootstrap] skip $version (already applied)"
        return 0
    fi
    echo "[db-bootstrap] applying $version"
    if [ "$version" = "0002_roles" ]; then
        $PSQL \
            -v gateway_user="$GATEWAY_DB_USER" -v gateway_pw="$GATEWAY_DB_PASSWORD" \
            -v control_user="$CONTROL_DB_USER" -v control_pw="$CONTROL_DB_PASSWORD" \
            -v audit_reader_user="$AUDIT_READER_DB_USER" -v audit_reader_pw="$AUDIT_READER_DB_PASSWORD" \
            -f "$file"
    else
        $PSQL -f "$file"
    fi
}

MIG_DIR="$(dirname "$0")/migrations"
for f in $(ls "$MIG_DIR"/*.sql | sort); do
    run_migration "$f"
done

echo "[db-bootstrap] seeding demo data"
$PSQL -f "$(dirname "$0")/seed.sql"

echo "[db-bootstrap] done"
