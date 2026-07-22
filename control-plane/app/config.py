"""Configuration + shared clients for the AEGIS control plane."""
import os


class Settings:
    tenant_id: str = os.getenv("AEGIS_TENANT_ID", "tenant_demo")

    pg_host: str = os.getenv("POSTGRES_HOST", "postgres")
    pg_port: int = int(os.getenv("POSTGRES_PORT", "5432"))
    pg_db: str = os.getenv("POSTGRES_DB", "aegis")
    pg_user: str = os.getenv("CONTROL_DB_USER", "aegis_control")
    pg_password: str = os.getenv("CONTROL_DB_PASSWORD", "aegis_control_pw")

    redis_host: str = os.getenv("REDIS_HOST", "redis")
    redis_port: int = int(os.getenv("REDIS_PORT", "6379"))

    # Operator API tokens -> role. Single-admin mode is explicitly labelled.
    admin_token: str = os.getenv("CONTROL_ADMIN_TOKEN", "admin-token-dev")
    operator_token: str = os.getenv("CONTROL_OPERATOR_TOKEN", "operator-token-dev")
    auditor_token: str = os.getenv("CONTROL_AUDITOR_TOKEN", "auditor-token-dev")

    # HMAC key used to sign audit checkpoints (NOT an external HSM/WORM anchor; MVP).
    checkpoint_key: str = os.getenv("AUDIT_CHECKPOINT_KEY", "checkpoint-hmac-dev")

    # Single-admin mode banner (approval workflow deferred; documented).
    single_admin_mode: bool = os.getenv("SINGLE_ADMIN_MODE", "true").lower() == "true"

    # Enforcement gateway + backend (used by the demo-run proxy so the browser
    # never has to mint agent workload JWTs). Read-only convenience for the UI.
    gateway_url: str = os.getenv("GATEWAY_URL", "http://gateway:8080")
    mockbank_url: str = os.getenv("MOCKBANK_URL", "http://mock-bank:9090")
    agent_jwt_secret: str = os.getenv("AGENT_JWT_HMAC_SECRET", "dev-agent-signing-secret-change-me")

    def pg_dsn(self) -> str:
        return (
            f"postgresql://{self.pg_user}:{self.pg_password}"
            f"@{self.pg_host}:{self.pg_port}/{self.pg_db}"
        )


settings = Settings()
