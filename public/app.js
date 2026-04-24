/* global document, fetch */

const chatMessages = document.querySelector("#chat-messages");
const chatInput = document.querySelector("#chat-input");
const chatSend = document.querySelector("#chat-send");
const threadIdInput = document.querySelector("#threadId");
const resultCard = document.querySelector("#result-card");
const resultContent = document.querySelector("#result-content");

if (
  !chatMessages ||
  !chatInput ||
  !chatSend ||
  !threadIdInput ||
  !resultCard ||
  !resultContent
) {
  throw new Error("Planner UI is missing required DOM elements.");
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const appendMessage = (role, html) => {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;
  wrapper.innerHTML = html;
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
};

const appendUserMessage = (text) => {
  appendMessage("user", `<p>${escapeHtml(text)}</p>`);
};

const appendAiMessage = (html) => {
  appendMessage("ai", html);
};

const appendAiText = (text) => {
  appendAiMessage(`<p>${escapeHtml(text)}</p>`);
};

const setLoading = (isLoading) => {
  chatSend.disabled = isLoading;
  chatInput.disabled = isLoading;
  if (isLoading) {
    chatSend.textContent = "…";
  } else {
    chatSend.textContent = "Send";
  }
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

const renderSingleFlightMarkup = (flight, label) => {
  if (!flight || typeof flight !== "object") {
    return `<p><strong>${escapeHtml(label)}</strong>: No flight options available.</p>`;
  }
  const route =
    Array.isArray(flight.route) && flight.route.length > 0
      ? flight.route.map((code) => escapeHtml(code)).join(" → ")
      : "-";
  const carriers =
    Array.isArray(flight.carriers) && flight.carriers.length > 0
      ? escapeHtml(flight.carriers.join(", "))
      : "-";
  return `
    <p><strong>${escapeHtml(label)}</strong></p>
    <p>
      Offer ID: ${escapeHtml(flight.offerId ?? "-")}<br />
      Total price: ${escapeHtml(flight.totalPrice ?? "-")}<br />
      Currency: ${escapeHtml(flight.currency ?? "-")}<br />
      Route: ${route}<br />
      Departure: ${escapeHtml(flight.departureAt ?? "-")}<br />
      Arrival: ${escapeHtml(flight.arrivalAt ?? "-")}<br />
      Carriers: ${carriers}
    </p>
  `;
};

const renderFlightMarkup = (finalPlan, flightOptions, returnFlightOptions) => {
  const options = Array.isArray(flightOptions) ? flightOptions : [];
  const returnOptions = Array.isArray(returnFlightOptions) ? returnFlightOptions : [];

  const selectedOfferId =
    typeof finalPlan?.selectedFlightOfferId === "string"
      ? finalPlan.selectedFlightOfferId
      : undefined;
  const recommendedFlight =
    (selectedOfferId
      ? options.find((option) => option?.offerId === selectedOfferId)
      : undefined) ?? options[0];

  const selectedReturnOfferId =
    typeof finalPlan?.selectedReturnFlightOfferId === "string"
      ? finalPlan.selectedReturnFlightOfferId
      : undefined;
  const recommendedReturnFlight =
    (selectedReturnOfferId
      ? returnOptions.find((option) => option?.offerId === selectedReturnOfferId)
      : undefined) ?? returnOptions[0];

  let html = "";
  if (recommendedFlight) {
    html += renderSingleFlightMarkup(recommendedFlight, "Outbound flight");
  }
  if (recommendedReturnFlight) {
    html += renderSingleFlightMarkup(recommendedReturnFlight, "Return flight");
  }
  if (!html) {
    return "<p>No flight options available.</p>";
  }
  return html;
};

const renderFinalPlanMarkup = (finalPlan, flightOptions, returnFlightOptions) => {
  if (!finalPlan || typeof finalPlan !== "object") {
    return "<p>Plan is not available yet.</p>";
  }
  const itineraryItems = Array.isArray(finalPlan.itinerary)
    ? finalPlan.itinerary
        .map((day) => {
          const date = escapeHtml(day?.date ?? "");
          const theme = escapeHtml(day?.theme ?? "");
          const weatherNote = escapeHtml(day?.weatherNote ?? "No weather note.");
          const activities = Array.isArray(day?.activities) ? day.activities : [];
          return `
            <li>
              <p><strong>${date}</strong> — ${theme}</p>
              <p><strong>Activities</strong></p>
              ${createListMarkup(activities, "No activities listed.")}
              <p><strong>Weather</strong>: ${weatherNote}</p>
            </li>
          `;
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
      <h3>Flights</h3>
      ${renderFlightMarkup(finalPlan, flightOptions, returnFlightOptions)}
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

const showPlanResult = (body) => {
  const values = body?.values ?? body ?? {};
  resultContent.innerHTML = renderFinalPlanMarkup(
    values.finalPlan ?? null,
    values.flightOptions ?? [],
    values.returnFlightOptions ?? [],
  );
  resultCard.classList.remove("hidden");
};



const handleChatResponse = async (body) => {
  if (body?.status === "awaiting_input") {
    const questions = body.pendingQuestions ?? [];
    let html = "<p>Require more information of your trip: </p><div class=\"question-list\">";
    questions.forEach((q, idx) => {
      html += `
        <div class="question-item" data-idx="${idx}">
          <p class="question-text">${escapeHtml(q)}</p>
          <input type="text" class="question-answer" placeholder="Your answer..." />
        </div>
      `;
    });
    html += "</div><button class=\"submit-answers\">Submit answers</button>";
    appendAiMessage(html);

    const btn = chatMessages.querySelector(".submit-answers");
    if (btn) {
      btn.addEventListener("click", async () => {
        const inputs = chatMessages.querySelectorAll(".question-answer");
        const answers = {};
        inputs.forEach((input, idx) => {
          const keyMap = ["travelStartDate", "travelEndDate", "budget"];
          const key = keyMap[idx] ?? `field_${idx}`;
          let value = input.value.trim();
          if (key === "budget") {
            const num = Number.parseFloat(value);
            value = Number.isFinite(num) ? num : value;
          }
          if (value) {
            answers[key] = value;
          }
        });

        if (Object.keys(answers).length === 0) {
          appendAiText("Please provide at least one answer.");
          return;
        }

        appendUserMessage(Object.values(answers).join(", "));
        setLoading(true);

        try {
          const threadId = threadIdInput.value.trim() || "chat-thread";
          const response = await fetch("/plan/chat/resume", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              threadId,
              scenario: "frontend-chat",
              answers,
            }),
          });
          const data = await parseResponseBody(response);
          if (!response.ok) {
            appendAiText(
              formatApiError(data, `Request failed with status ${response.status}.`),
            );
            return;
          }
          await handleChatResponse(data);
        } catch (err) {
          appendAiText(err instanceof Error ? err.message : "Unexpected error.");
        } finally {
          setLoading(false);
        }
      });
    }
    return;
  }

  if (body?.status === "complete") {
    appendAiText("🎉 Your travel plan is ready!");
    showPlanResult(body);
    return;
  }

  if (body?.status === "in_progress") {
    appendAiText("Planning in progress... You can check back later with the same thread ID.");
    return;
  }

  appendAiText("Received an unexpected response. Please try again.");
};

const sendNaturalLanguage = async () => {
  const text = chatInput.value.trim();
  if (!text) return;

  appendUserMessage(text);
  chatInput.value = "";
  setLoading(true);

  try {
    const threadId = threadIdInput.value.trim() || "chat-thread";
    const response = await fetch("/plan/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadId,
        scenario: "frontend-chat",
        naturalLanguage: text,
      }),
    });
    const data = await parseResponseBody(response);
    if (!response.ok) {
      appendAiText(
        formatApiError(data, `Request failed with status ${response.status}.`),
      );
      return;
    }
    await handleChatResponse(data);
  } catch (err) {
    appendAiText(err instanceof Error ? err.message : "Unexpected error.");
  } finally {
    setLoading(false);
  }
};

chatSend.addEventListener("click", sendNaturalLanguage);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendNaturalLanguage();
  }
});

appendAiText(
  "Hello! I'm NaviGo, your travel planning assistant. Describe your trip and I'll help you plan it. For example: \"I want to visit Tokyo for 5 days with a budget of 2500 USD.\"",
);
