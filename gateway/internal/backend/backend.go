// Package backend is the protected-backend adapter. It sends a gateway-only
// credential (never available to agents), preserves the idempotency key, bounds
// timeouts, and maps the response into COMMITTED / RELEASED / UNKNOWN without
// guessing (SRS 10.4, FR-025).
package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type Outcome string

const (
	OutcomeCommitted Outcome = "COMMITTED" // proven success
	OutcomeReleased  Outcome = "RELEASED"  // proven pre-execution failure
	OutcomeUnknown   Outcome = "UNKNOWN"   // timeout / ambiguous
)

type Adapter struct {
	baseURL    string
	credential string
	client     *http.Client
}

func New(baseURL, credential string) *Adapter {
	return &Adapter{
		baseURL:    baseURL,
		credential: credential,
		client: &http.Client{
			Timeout: 3 * time.Second, // total timeout; ambiguity => UNKNOWN
		},
	}
}

type DispatchRequest struct {
	IdempotencyKey string
	CorrelationID  string
	PayeeID        string
	AmountMinor    int64
	Currency       string
	// Behavior hint for the mock backend so scenarios can force timeout/fail.
	SimMode string
}

type DispatchResult struct {
	Outcome          Outcome
	BackendReference string
}

// Dispatch forwards the action. Timeouts / ambiguous errors => UNKNOWN.
func (a *Adapter) Dispatch(ctx context.Context, req DispatchRequest) (*DispatchResult, error) {
	body, _ := json.Marshal(map[string]interface{}{
		"correlation_id": req.CorrelationID,
		"payee_id":       req.PayeeID,
		"amount_minor":   req.AmountMinor,
		"currency":       req.Currency,
		"sim_mode":       req.SimMode,
	})
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/execute", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Gateway-Credential", a.credential)
	httpReq.Header.Set("Idempotency-Key", req.IdempotencyKey)

	resp, err := a.client.Do(httpReq)
	if err != nil {
		// Network error AFTER we may have sent the request => ambiguous => UNKNOWN.
		// (Connection-refused before send would also land here; conservative UNKNOWN
		// is safe because no reservation is released on UNKNOWN.)
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return &DispatchResult{Outcome: OutcomeUnknown}, nil
		}
		return &DispatchResult{Outcome: OutcomeUnknown}, nil
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var out struct {
			BackendReference string `json:"backend_reference"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return &DispatchResult{Outcome: OutcomeCommitted, BackendReference: out.BackendReference}, nil
	case http.StatusUnprocessableEntity, http.StatusBadRequest, http.StatusConflict:
		// Proven pre-execution rejection.
		return &DispatchResult{Outcome: OutcomeReleased}, nil
	case http.StatusGatewayTimeout, http.StatusRequestTimeout:
		return &DispatchResult{Outcome: OutcomeUnknown}, nil
	default:
		// 5xx or unexpected => ambiguous => UNKNOWN (do not guess success/failure).
		return &DispatchResult{Outcome: OutcomeUnknown}, nil
	}
}
