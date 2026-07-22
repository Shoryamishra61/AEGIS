"""RBAC for the control plane (dev token->role stand-in for enterprise OIDC).

Roles:
  admin    : full control incl. policy activation, emergency stop/resume.
  operator : emergency stop/resume, read config, read audit.
  auditor  : read-only audit + integrity verification.

Single-admin mode (labelled + audited): dual-control is bypassed; a single admin
may activate policy and halt/resume. Approval workflow is deferred (documented).
"""
from fastapi import Depends, Header, HTTPException

from .config import settings

ROLE_ADMIN = "admin"
ROLE_OPERATOR = "operator"
ROLE_AUDITOR = "auditor"


class Principal:
    def __init__(self, subject: str, role: str):
        self.subject = subject
        self.role = role


def _token_to_principal(token: str) -> Principal | None:
    if token == settings.admin_token:
        return Principal("operator-admin", ROLE_ADMIN)
    if token == settings.operator_token:
        return Principal("operator-ops", ROLE_OPERATOR)
    if token == settings.auditor_token:
        return Principal("operator-audit", ROLE_AUDITOR)
    return None


async def current_principal(authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    p = _token_to_principal(token)
    if p is None:
        raise HTTPException(status_code=401, detail="invalid token")
    return p


def require_roles(*roles: str):
    async def _dep(principal: Principal = Depends(current_principal)) -> Principal:
        if principal.role not in roles:
            raise HTTPException(status_code=403, detail=f"role {principal.role} not permitted")
        return principal
    return _dep
