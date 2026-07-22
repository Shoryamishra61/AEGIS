"""Python mirror of the gateway reason-code registry (gateway/internal/reason).

This is the SINGLE narrative source for deterministic explanations in the control
plane. Categories and advice mirror the gateway's fail-closed semantics: any code
not present here is treated as STOP (see extensions._append/explain).

Keep in sync with gateway/internal/reason/reason.go. Advice values: PROCEED|WAIT|STOP.
Categories: PERMIT|POLICY|BUDGET|CONTAINMENT|SCHEMA|IDENTITY|EXECUTION|IDEMPOTENCY|CONFIG.
"""

REASON_CATALOG: dict[str, dict] = {
    # ---- permit / success ----
    "POLICY_PERMIT": {"category": "PERMIT", "advice": "PROCEED",
                      "meaning": "Policy explicitly permitted the action.",
                      "inspect_next": "None — the action satisfied policy."},
    "BUDGET_RESERVED": {"category": "BUDGET", "advice": "PROCEED",
                        "meaning": "Budget was atomically reserved for this action.",
                        "inspect_next": "Confirm commit/reconciliation in the timeline."},

    # ---- idempotency ----
    "IDEMPOTENT_REPLAY": {"category": "IDEMPOTENCY", "advice": "PROCEED",
                          "meaning": "Replay of a prior request; the original decision was returned.",
                          "inspect_next": "This is the same decision as the first call."},
    "IDEMPOTENCY_CONFLICT": {"category": "IDEMPOTENCY", "advice": "STOP",
                             "meaning": "Same idempotency key was reused with a different body.",
                             "inspect_next": "The agent must use a new key or the identical body."},

    # ---- identity ----
    "IDENTITY_INVALID": {"category": "IDENTITY", "advice": "STOP",
                         "meaning": "The agent's workload credential failed verification.",
                         "inspect_next": "Check the agent's identity binding and token."},
    "AGENT_UNKNOWN": {"category": "IDENTITY", "advice": "STOP",
                      "meaning": "No registered agent matches the credential subject.",
                      "inspect_next": "Register the agent or correct its workload_sub."},
    "AGENT_NOT_ACTIVE": {"category": "IDENTITY", "advice": "STOP",
                         "meaning": "The agent is not in an active state.",
                         "inspect_next": "Activate the agent on the Agents page."},

    # ---- schema ----
    "SCHEMA_INVALID": {"category": "SCHEMA", "advice": "STOP",
                       "meaning": "The action envelope failed schema validation.",
                       "inspect_next": "Inspect required fields and integer minor-unit amounts."},
    "STALE_REQUEST": {"category": "SCHEMA", "advice": "STOP",
                      "meaning": "The request was too old to be considered fresh.",
                      "inspect_next": "The agent should re-issue the intent."},

    # ---- containment (highest precedence) ----
    "FLEET_HALTED": {"category": "CONTAINMENT", "advice": "STOP",
                     "meaning": "The entire fleet is halted; all actions are blocked.",
                     "inspect_next": "Emergency Control shows the halt epoch and actor."},
    "AGENT_REVOKED": {"category": "CONTAINMENT", "advice": "STOP",
                      "meaning": "This agent has been revoked; its actions are blocked.",
                      "inspect_next": "Emergency Control — reinstate via the controlled workflow."},
    "SAFETY_STATE_UNKNOWN": {"category": "CONTAINMENT", "advice": "STOP",
                             "meaning": "Containment state could not be confirmed fresh; fail-closed.",
                             "inspect_next": "Check gateway freshness on System Health."},

    # ---- policy denials ----
    "POLICY_DENY": {"category": "POLICY", "advice": "STOP",
                    "meaning": "Policy rules rejected this action.",
                    "inspect_next": "Open Policy Studio to see the determining rule."},
    "PAYEE_NOT_ALLOWED": {"category": "POLICY", "advice": "STOP",
                          "meaning": "The payee is not on the agent's allow-list.",
                          "inspect_next": "Review the payee allow-list in Policy Studio (data.json)."},
    "ENVIRONMENT_BLOCKED": {"category": "POLICY", "advice": "STOP",
                            "meaning": "The action's environment is not permitted.",
                            "inspect_next": "Check the agent's environment binding."},
    "NO_EXPLICIT_PERMIT": {"category": "POLICY", "advice": "STOP",
                           "meaning": "No rule explicitly permitted the action (default-deny).",
                           "inspect_next": "A permitting rule must exist for this action."},
    "REQUIRE_APPROVAL": {"category": "POLICY", "advice": "STOP",
                         "meaning": "Policy requires approval; in single-admin MVP this fails closed.",
                         "inspect_next": "Approval workflow is deferred; action is safely blocked."},

    # ---- budget ----
    "PER_TXN_CAP_EXCEEDED": {"category": "BUDGET", "advice": "STOP",
                             "meaning": "The amount exceeds the per-transaction cap.",
                             "inspect_next": "Budgets & Pools — review the per-txn cap."},
    "WINDOW_CAP_EXCEEDED": {"category": "BUDGET", "advice": "WAIT",
                            "meaning": "The rolling-window spend cap would be exceeded.",
                            "inspect_next": "Budgets & Pools — wait for the window to roll or raise the cap."},
    "SHARED_POOL_EXCEEDED": {"category": "BUDGET", "advice": "WAIT",
                             "meaning": "The shared pool cap would be exceeded.",
                             "inspect_next": "Budgets & Pools — shared exposure across agents."},

    # ---- execution outcomes ----
    "EXECUTION_COMMITTED": {"category": "EXECUTION", "advice": "PROCEED",
                            "meaning": "The backend committed the transaction.",
                            "inspect_next": "None — settled."},
    "EXECUTION_RELEASED": {"category": "EXECUTION", "advice": "PROCEED",
                           "meaning": "The backend rejected it; the reservation was released.",
                           "inspect_next": "No exposure retained."},
    "EXECUTION_UNKNOWN": {"category": "EXECUTION", "advice": "WAIT",
                          "meaning": "The backend outcome is UNKNOWN; exposure is held pending reconciliation.",
                          "inspect_next": "Resolve in Reconciliation — never assume success or failure."},

    # ---- config / emergency (control-plane events) ----
    "AGENT_UPDATED": {"category": "CONFIG", "advice": "PROCEED",
                      "meaning": "Agent configuration was updated.", "inspect_next": ""},
    "AGENT_REGISTERED": {"category": "CONFIG", "advice": "PROCEED",
                         "meaning": "A new agent was registered.", "inspect_next": ""},
    "POLICY_ACTIVATED": {"category": "CONFIG", "advice": "PROCEED",
                         "meaning": "A policy version was activated.", "inspect_next": ""},
    "POLICY_DRAFTED": {"category": "CONFIG", "advice": "PROCEED",
                       "meaning": "A draft policy version was created (inactive).", "inspect_next": ""},
    "FLEET_RESUMED": {"category": "CONFIG", "advice": "PROCEED",
                      "meaning": "The fleet was resumed.", "inspect_next": ""},
    "AGENT_REINSTATED": {"category": "CONFIG", "advice": "PROCEED",
                         "meaning": "An agent was reinstated.", "inspect_next": ""},
}

_ADVICE_RANK = {"PROCEED": 0, "WAIT": 1, "STOP": 2}


def advice_for(reason_codes: list[str]) -> str:
    """Aggregate advice = the most severe advice across the codes (fail-closed).
    Unknown codes are treated as STOP."""
    worst = "PROCEED"
    for rc in reason_codes or []:
        meta = REASON_CATALOG.get(rc)
        a = meta["advice"] if meta else "STOP"
        if _ADVICE_RANK[a] > _ADVICE_RANK[worst]:
            worst = a
    return worst
