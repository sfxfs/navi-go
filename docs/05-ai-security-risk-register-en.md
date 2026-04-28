# 5. AI Security Risk Register

This risk register is compiled from the current repository implementation and CI/CD configurations (`.github/workflows/ci.yml`, `cd.yml`, `llmsecops.yml`).

## 5.1 Risk Matrix (Qualitative)

| Risk ID | Risk Item | Likelihood | Impact | Residual Risk |
|---|---|---|---|---|
| R-01 | Prompt Injection / unauthorized command injection | Medium | High | Medium-Low |
| R-02 | Unsafe content output | Low-Medium | High | Low |
| R-03 | LLM structured output bias/hallucination | Medium | Medium | Low |
| R-04 | External dependency and supply chain risk | Medium | High | Medium |
| R-05 | Key leakage and credential misuse | Low-Medium | High | Medium-Low |
| R-06 | Upstream API anomalies causing availability degradation | Medium | Medium | Medium |
| R-07 | Insufficient data minimization (thread state persistence) | Medium | Medium | Medium |
| R-08 | Adversarial samples bypassing static rules | Medium | High | Medium |

## 5.2 Risk Details and Controls

### R-01 Prompt Injection / Unauthorized Injection

**Attack Surface**
- User input `userRequest.requestText` and `naturalLanguage`

**Existing Controls**
- `detectPromptInjection(...)` (`src/security/guardrails.ts`) applies regex detection for common injection statements, with zero-width character and homoglyph normalization.
- `risk_guard` uses LLM semantic scanning (`RiskGuardSchema`) to detect variant attacks.
- Upon detection, writes `BLOCKED_PROMPT_INJECTION` prefixed flag.
- `routeFromRiskGuard(...)` routes flow to `plan_synthesizer` safe refusal path.

**Verification Evidence**
- `tests/unit/agents/risk-guard.agent.test.ts`
- `tests/redteam/guardrails.redteam.test.ts` (red-team adversarial testing)

**Residual Risk**
- Coverage for encoding, semantic rewriting, multilingual obfuscation, and indirect injection (via structured data/comments) remains limited.

---

### R-02 Unsafe Output

**Attack Surface**
- Final plan summary text

**Existing Controls**
- `detectUnsafeOutput(...)` (`src/security/guardrails.ts`)
- `plan_synthesizer` rescans generated summary and appends `safetyFlags`
- `risk_guard` LLM semantic layer also scans final outputs

**Verification Evidence**
- `tests/unit/security/guardrails.test.ts`
- `tests/redteam/guardrails.redteam.test.ts`

**Residual Risk**
- Rule library maintainability and coverage depend on manual updates; LLM semantic layer may miss harmful content disguised as travel advice.

---

### R-03 LLM Output Bias / Hallucination

**Attack Surface**
- Preference extraction, destination suggestion, itinerary generation, budget estimation

**Existing Controls**
- `withStructuredOutput(...)` + Zod schema constraints on all LLM agent outputs.
- IATA/City code format constraints.
- User explicit interests can override model-extracted results.
- User explicit destination (hint + code) has fallback merge logic.
- External tools (Duffel, Open-Meteo) provide grounding data for itinerary and budget.

**Verification Evidence**
- `tests/integration/*.test.ts` (FakeStructuredChatModel driven)
- `tests/evals/travel-planner.eval.ts` (completeness evaluation)

**Residual Risk**
- Structural validity does not imply semantic correctness; LLM may generate non-existent destinations, non-existent flights, or unrealistic budgets.

---

### R-04 Supply Chain Risk

**Attack Surface**
- npm dependencies, container images, build artifacts

**Existing Controls (CI/CD Enabled)**
- `npm audit --omit=dev` (CI / LLMSecOps)
- TruffleHog secret scan (CI)
- Semgrep security scan (CI / LLMSecOps)
- Trivy image scan (CI/CD)
- SBOM generation and upload (CI/CD)
- Build provenance attestation (CD)
- AI dependency security scan (`scripts/ai-dependency-scan.ts`, LLMSecOps)
- Blocklist check for known compromised packages (LLMSecOps)

**Verification Evidence**
- `.github/workflows/ci.yml`
- `.github/workflows/cd.yml`
- `.github/workflows/llmsecops.yml`

**Residual Risk**
- Relies primarily on "known vulnerability" detection; zero-day risks remain.

---

### R-05 Key Leakage and Credential Misuse

**Attack Surface**
- `OPENAI_API_KEY`, `DUFFEL_API_TOKEN`, `POSTGRES_URL`, `LANGSMITH_API_KEY`

**Existing Controls**
- Environment variable schema validation + `require*` accessors.
- Duffel token injected only via request headers (`src/tools/common/duffel.ts`).
- Tool layer unified `ToolError`, avoiding exposing sensitive context to callers.
- TruffleHog scans repository secrets.
- `model-config-audit` workflow scans source code for hardcoded API key patterns.

**Residual Risk**
- Debug logs or external system misconfiguration may still cause leakage.

---

### R-06 Upstream API Anomalies and Availability

**Attack Surface**
- Duffel, Open-Meteo network jitter or rate limiting

**Existing Controls**
- `requestJson(...)` unified timeout, exponential backoff retry with jitter, and AbortController.
- HTTP failures mapped to `ToolError` categories.
- API layer returns 502 for `ToolError`, avoiding silent swallowing.
- Fastify rate limit (100 req/min) mitigates abuse.

**Verification Evidence**
- `tests/unit/tools/http.test.ts`
- `src/tools/common/http.ts`

**Residual Risk**
- End-to-end success rate is still affected when multiple upstreams fail simultaneously.

---

### R-07 Insufficient Data Minimization

**Risk Description**
- `PlannerState` contains full `userRequest`; default checkpointer is Postgres persistence.
- Therefore thread state may contain user-identifying information (e.g., `userId`).

**Existing Controls**
- Thread-level isolation (`thread_id`).
- Database retention cycle can be controlled via deployment policy.

**Recommended Controls**
- Introduce `userId` mapping/anonymization strategy in production.
- Define TTL or archival cleanup tasks for checkpoint data.

---

### R-08 Adversarial Samples Bypassing Static Rules

**Risk Description**
- Attackers may use zero-width characters, homoglyphs, or indirect injection (embedded inside Markdown/HTML comments) to bypass `detectPromptInjection` regex rules.

**Existing Controls**
- `normalizeForScan` already normalizes zero-width characters and common homoglyphs.
- `risk_guard` LLM semantic layer is the primary defense; static rules serve as fast pre-filter.
- Red-team tests (`tests/redteam/`) continuously evaluate bypass rates.

**Verification Evidence**
- `tests/redteam/guardrails.redteam.test.ts`

**Residual Risk**
- LLM semantic layer itself may be bypassed by targeted jailbreak prompts; no adversarial training or dedicated classifier model exists yet.

## 5.3 Incident Response Process (Recommended)

1. **Detection**: `safetyFlags` hit high-risk markers
2. **Isolation**: Trace related requests by `threadId` and stop retries
3. **Forensics**: Read `GET /plan/:threadId` snapshot + decisionLog
4. **Remediation**: Supplement guardrail rules or policies
5. **Regression**: Add corresponding unit/red-team/integration tests to prevent recurrence

## 5.4 Recommended Next Steps

| Priority | Recommendation |
|---|---|
| High | Add a dedicated lightweight classifier model for prompt injection (rules + LLM + classifier triple layer) |
| High | Introduce data minimization and expiration cleanup policies for thread state |
| Medium | Add authentication layer for `/plan` (by user/thread) |
| Medium | Establish a larger-scale security regression corpus (injection, privilege escalation, jailbreak) |
| Medium | Incorporate red-team detection rate into CI quality dashboard |
| Low | Output unified audit event stream for risk hits (for SIEM integration) |
