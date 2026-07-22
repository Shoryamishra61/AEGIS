// Package config loads gateway configuration from the environment. All values
// have safe defaults suitable for the local Docker Compose stack.
package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	TenantID string

	GatewayID   string
	GatewayPort int

	// Postgres (gateway runtime role: append audit + read config)
	PGHost string
	PGPort int
	PGUser string
	PGPass string
	PGDB   string

	// Redis
	RedisHost string
	RedisPort int

	// Identity
	AgentJWTSecret string

	// Safety freshness deadline (seconds)
	FreshnessSeconds int

	// Backend
	BackendBaseURL          string
	BackendGatewayCredential string
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func Load() *Config {
	c := &Config{
		TenantID:                 getenv("AEGIS_TENANT_ID", "tenant_demo"),
		GatewayID:                getenv("GATEWAY_ID", hostname()),
		GatewayPort:              getenvInt("GATEWAY_PORT", 8080),
		PGHost:                   getenv("POSTGRES_HOST", "postgres"),
		PGPort:                   getenvInt("POSTGRES_PORT", 5432),
		PGUser:                   getenv("GATEWAY_DB_USER", "aegis_gateway"),
		PGPass:                   getenv("GATEWAY_DB_PASSWORD", "aegis_gateway_pw"),
		PGDB:                     getenv("POSTGRES_DB", "aegis"),
		RedisHost:                getenv("REDIS_HOST", "redis"),
		RedisPort:                getenvInt("REDIS_PORT", 6379),
		AgentJWTSecret:           getenv("AGENT_JWT_HMAC_SECRET", "dev-agent-signing-secret-change-me"),
		FreshnessSeconds:         getenvInt("SAFETY_FRESHNESS_SECONDS", 5),
		BackendBaseURL:           getenv("BACKEND_BASE_URL", "http://mock-bank:9090"),
		BackendGatewayCredential: getenv("BACKEND_GATEWAY_CREDENTIAL", "gw-only-shared-secret"),
	}
	return c
}

func (c *Config) PGDSN() string {
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		c.PGUser, c.PGPass, c.PGHost, c.PGPort, c.PGDB)
}

func (c *Config) RedisAddr() string {
	return fmt.Sprintf("%s:%d", c.RedisHost, c.RedisPort)
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "gateway-local"
	}
	return "gateway-" + h
}
