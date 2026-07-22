package reason

import "testing"

func TestAdviceMapping(t *testing.T) {
	cases := map[string]AgentAdvice{
		WindowCapExceeded:     AdviceWait,
		SharedPoolCapExceeded: AdviceWait,
		ExecutionUnknown:      AdviceReconcile,
		SchemaInvalid:         AdviceFix,
		RequireApproval:       AdviceApproval,
		PolicyDeny:            AdviceStop,
		FleetHalted:           AdviceStop,
		AgentRevoked:          AdviceStop,
		PolicyPermit:          AdviceProceed,
	}
	for code, want := range cases {
		if got := Advice(code); got != want {
			t.Errorf("Advice(%s)=%s want %s", code, got, want)
		}
	}
}

func TestHTTPStatusMapping(t *testing.T) {
	cases := []struct {
		effect, code string
		want         int
	}{
		{EffectAllow, PolicyPermit, 200},
		{EffectDeny, Unauthenticated, 401},
		{EffectDeny, FleetHalted, 403},
		{EffectDeny, AgentRevoked, 403},
		{EffectDeny, PolicyDeny, 403},
		{EffectDeny, SchemaInvalid, 422},
		{EffectDeny, IdempotencyConflict, 409},
		{EffectDeny, WindowCapExceeded, 429},
		{EffectDeny, AuditWriteFailed, 503},
		{EffectDeny, DependencyDown, 503},
	}
	for _, c := range cases {
		if got := HTTPStatus(c.effect, c.code); got != c.want {
			t.Errorf("HTTPStatus(%s,%s)=%d want %d", c.effect, c.code, got, c.want)
		}
	}
}

func TestUnknownCodeIsFailClosed(t *testing.T) {
	// Unknown reason codes must default to STOP advice and 403 (deny).
	if Advice("SOME_NEW_CODE") != AdviceStop {
		t.Fatal("unknown code should advise STOP")
	}
	if HTTPStatus(EffectDeny, "SOME_NEW_CODE") != 403 {
		t.Fatal("unknown deny code should be 403")
	}
}
