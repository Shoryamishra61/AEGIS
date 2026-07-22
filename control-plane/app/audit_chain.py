"""Audit hash-chain utilities: canonical serialization matching the Go gateway,
integrity verification, and HMAC checkpoint signing (P1 FR-044/045).

The canonical string MUST byte-match gateway/internal/audit/audit.go:canonicalString
so the chain verifies regardless of which component wrote a row.
"""
import hashlib
import hmac
import json

from .config import settings

GENESIS = "sha256:0000000000000000000000000000000000000000000000000000000000000000"


def canonical_string(chain_id: str, event_type: str, correlation_id: str,
                     decision: str, reason_code: str, agent_id: str,
                     policy_version: int, payload_json: str, prev_hash: str) -> str:
    # v1|chain|type|corr|decision|reason|agent|polver|payload_json|prev
    return (
        f"v1|{chain_id}|{event_type}|{correlation_id}|{decision}|{reason_code}|"
        f"{agent_id}|{policy_version}|{payload_json}|{prev_hash}"
    )


def compute_event_hash(chain_id: str, row: dict) -> str:
    # Re-parse + re-serialize canonically (sorted keys, compact) so the bytes match
    # Go's json.Marshal(map) output regardless of Postgres JSONB normalization.
    payload = row["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    canon = canonical_string(
        chain_id,
        row["event_type"],
        row["correlation_id"],
        row["decision"] or "",
        row["reason_code"] or "",
        row["agent_id"] or "",
        row["policy_version"] or 0,
        payload_json,
        row["prev_hash"],
    )
    return "sha256:" + hashlib.sha256(canon.encode()).hexdigest()


def sign_checkpoint(tip_hash: str) -> str:
    mac = hmac.new(settings.checkpoint_key.encode(), tip_hash.encode(), hashlib.sha256)
    return "hmac-sha256:" + mac.hexdigest()


def verify_checkpoint(tip_hash: str, signature: str) -> bool:
    return hmac.compare_digest(sign_checkpoint(tip_hash), signature)
