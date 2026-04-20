/* global document, fetch, FormData, HTMLInputElement */

const planForm = document.querySelector("#plan-form");
const stateForm = document.querySelector("#state-form");
const submitButton = document.querySelector("#submit-button");
const stateButton = document.querySelector("#state-button");
const submitStatus = document.querySelector("#submit-status");
const stateStatus = document.querySelector("#state-status");
const resultCard = document.querySelector("#result-card");
const resultContent = document.querySelector("#result-content");

const requiredElements = [
  planForm,
  stateForm,
  submitButton,
  stateButton,
  submitStatus,
  stateStatus,
  resultCard,
  resultContent,
];

if (requiredElements.some((element) => element == null)) {
  throw new Error("Planner UI is missing required DOM elements.");
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const setStatus = (element, message, isError = false) => {
  element.textContent = message;
  element.classList.toggle("error", isError);
};

const parseInterests = (rawInterests) =>
  rawInterests
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const nonEmpty = (value) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asUpperIata = (value) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : undefined;
};

const formatApiError = (payload, fallbackMessage) => {
  if (!payload || typeof payload !== "object") {
    return fallbackMessage;
  }

  if ("message" in payload && typeof payload.message === "string") {
    const provider =
      "provider" in payload && typeof payload.provider === "string"
        ? ` (${payload.provider})`
        : "";
    const errorCode =
      "error" in payload && typeof payload.error === "string"
        ? `${payload.error}: `
        : "";

    return `${errorCode}${payload.message}${provider}`;
  }

  return fallbackMessage;
};

const createListMarkup = (items, emptyMessage = "None") => {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p>${escapeHtml(emptyMessage)}</p>`;
  }

  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
};

const renderDecisionLogMarkup = (decisionLog) => {
  if (!Array.isArray(decisionLog) || decisionLog.length === 0) {
    return "<p>No decision log entries.</p>";
  }

  const items = decisionLog.map((entry) => {
    const agent = escapeHtml(entry?.agent ?? "agent");
    const summary = escapeHtml(entry?.outputSummary ?? "");
    const evidence = Array.isArray(entry?.keyEvidence)
      ? escapeHtml(entry.keyEvidence.join("; "))
      : "";

    return `<li><strong>${agent}</strong>: ${summary}<br /><small>${evidence}</small></li>`;
  });

  return `<ul>${items.join("")}</ul>`;
};

const toJsonPre = (value) => `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;

const renderFinalPlanMarkup = (finalPlan) => {
  if (!finalPlan || typeof finalPlan !== "object") {
    return "<p>Plan is not available yet for this thread.</p>";
  }

  const itineraryItems = Array.isArray(finalPlan.itinerary)
    ? finalPlan.itinerary
        .map((day) => {
          const date = escapeHtml(day?.date ?? "");
          const theme = escapeHtml(day?.theme ?? "");
          return `<li><strong>${date}</strong> — ${theme}</li>`;
        })
        .join("")
    : "";

  const budget = finalPlan.budget ?? {};

  return `
    <div class="result-group">
      <h3>Summary</h3>
      <p>${escapeHtml(finalPlan.summary ?? "(no summary)")}</p>
    </div>
    <div class="result-group">
      <h3>Destination</h3>
      <p>${escapeHtml(finalPlan.selectedDestination ?? "(not selected)")}</p>
    </div>
    <div class="result-group">
      <h3>Itinerary</h3>
      ${itineraryItems ? `<ul>${itineraryItems}</ul>` : "<p>No itinerary entries.</p>"}
    </div>
    <div class="result-group">
      <h3>Budget</h3>
      <p>
        Estimated total: ${escapeHtml(budget.estimatedTotal ?? "-")}<br />
        Budget limit: ${escapeHtml(budget.budgetLimit ?? "-")}<br />
        Within budget: ${escapeHtml(budget.withinBudget ?? "-")}
      </p>
      <p><strong>Optimization tips</strong></p>
      ${createListMarkup(budget.optimizationTips)}
    </div>
    <div class="result-group">
      <h3>Packing list</h3>
      ${createListMarkup(finalPlan.packingList)}
    </div>
    <div class="result-group">
      <h3>Safety flags</h3>
      ${createListMarkup(finalPlan.safetyFlags)}
    </div>
  `;
};

const renderPlanResponse = (responseBody) => {
  resultContent.innerHTML = `
    ${renderFinalPlanMarkup(responseBody.finalPlan)}
    <div class="result-group">
      <h3>Decision log</h3>
      ${renderDecisionLogMarkup(responseBody.decisionLog)}
    </div>
    <details class="result-group">
      <summary>Raw response</summary>
      ${toJsonPre(responseBody)}
    </details>
  `;
  resultCard.classList.remove("hidden");
};

const renderStateResponse = (responseBody) => {
  const finalPlan = responseBody?.values?.finalPlan ?? null;
  const safetyFlags = responseBody?.values?.safetyFlags ?? [];

  resultContent.innerHTML = `
    ${renderFinalPlanMarkup(finalPlan)}
    <div class="result-group">
      <h3>Safety flags (state)</h3>
      ${createListMarkup(safetyFlags)}
    </div>
    <details class="result-group">
      <summary>Raw state payload</summary>
      ${toJsonPre(responseBody)}
    </details>
  `;
  resultCard.classList.remove("hidden");
};

const readPlanPayload = () => {
  const formData = new FormData(planForm);

  const threadId = String(formData.get("threadId") ?? "").trim();
  const requestText = String(formData.get("requestText") ?? "").trim();
  const travelStartDate = String(formData.get("travelStartDate") ?? "").trim();
  const travelEndDate = String(formData.get("travelEndDate") ?? "").trim();
  const budget = Number(formData.get("budget"));

  const originIata = asUpperIata(String(formData.get("originIata") ?? ""));
  const destinationHint = nonEmpty(String(formData.get("destinationHint") ?? ""));
  const destinationCityCode = asUpperIata(
    String(formData.get("destinationCityCode") ?? ""),
  );
  const destinationIata = asUpperIata(
    String(formData.get("destinationIata") ?? ""),
  );
  const interests = parseInterests(String(formData.get("interests") ?? ""));

  return {
    threadId,
    scenario: "frontend",
    userRequest: {
      userId: "anonymous",
      requestText,
      travelStartDate,
      travelEndDate,
      budget,
      adults: 1,
      children: 0,
      interests,
      ...(originIata ? { originIata } : {}),
      ...(destinationHint ? { destinationHint } : {}),
      ...(destinationCityCode ? { destinationCityCode } : {}),
      ...(destinationIata ? { destinationIata } : {}),
    },
  };
};

const parseResponseBody = async (response) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const text = await response.text();
  return text ? { message: text } : null;
};

planForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!planForm.reportValidity()) {
    setStatus(submitStatus, "Please fill required fields.", true);
    return;
  }

  const payload = readPlanPayload();
  if (payload.userRequest.travelEndDate < payload.userRequest.travelStartDate) {
    setStatus(submitStatus, "Travel end date must be on or after start date.", true);
    return;
  }

  setStatus(submitStatus, "Submitting...");
  submitButton.disabled = true;

  try {
    const response = await fetch("/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
      setStatus(
        submitStatus,
        formatApiError(body, `Request failed with status ${response.status}.`),
        true,
      );
      return;
    }

    renderPlanResponse(body);

    const threadIdInput = document.querySelector("#stateThreadId");
    if (threadIdInput instanceof HTMLInputElement) {
      threadIdInput.value = payload.threadId;
    }

    setStatus(submitStatus, `Plan created for thread ${payload.threadId}.`);
    setStatus(stateStatus, "");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    setStatus(submitStatus, message, true);
  } finally {
    submitButton.disabled = false;
  }
});

stateForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!stateForm.reportValidity()) {
    setStatus(stateStatus, "Thread ID is required.", true);
    return;
  }

  const formData = new FormData(stateForm);
  const threadId = String(formData.get("stateThreadId") ?? "").trim();

  setStatus(stateStatus, "Loading state...");
  stateButton.disabled = true;

  try {
    const response = await fetch(`/plan/${encodeURIComponent(threadId)}`);
    const body = await parseResponseBody(response);

    if (!response.ok) {
      setStatus(
        stateStatus,
        formatApiError(body, `Load failed with status ${response.status}.`),
        true,
      );
      return;
    }

    renderStateResponse(body);

    if (body?.values?.finalPlan == null) {
      setStatus(stateStatus, "State loaded, but no final plan is available yet.", true);
      return;
    }

    setStatus(stateStatus, `State loaded for thread ${threadId}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    setStatus(stateStatus, message, true);
  } finally {
    stateButton.disabled = false;
  }
});

for (const inputId of ["originIata", "destinationCityCode", "destinationIata"]) {
  const element = document.querySelector(`#${inputId}`);
  if (element instanceof HTMLInputElement) {
    element.addEventListener("blur", () => {
      element.value = element.value.trim().toUpperCase();
    });
  }
}
