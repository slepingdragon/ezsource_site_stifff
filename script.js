const state = {
  rfp: null,
  proposal: null,
  sourceUrl: "",
  n8nUrl: "",
  deliveries: []
};

document.addEventListener("DOMContentLoaded", () => {
  const sourceInput = document.getElementById("source-url");
  const refreshBtn = document.getElementById("refresh-btn");
  const n8nInput = document.getElementById("n8n-url");
  const yearStamp = document.getElementById("year");
  const defaultSource = new URL("../site1/rfp.json", window.location.href).href;
  const defaultN8nUrl = "http://localhost:5678/webhook-test/10b9cd18-a9bf-4464-a202-141f3bd3e8cf";

  if (sourceInput) {
    sourceInput.value = defaultSource;
  }
  state.sourceUrl = defaultSource;

  if (n8nInput) {
    n8nInput.value = defaultN8nUrl;
  }
  state.n8nUrl = defaultN8nUrl;

  if (yearStamp) {
    yearStamp.textContent = String(new Date().getFullYear());
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      const url = (sourceInput?.value || "").trim();
      if (url) {
        fetchAndGenerate(url);
      }
    });
  }

  setupCopyHandlers();
  setupN8nHandlers();
  renderDeliveryFeed();
  fetchAndGenerate(defaultSource);
});

async function fetchAndGenerate(url) {
  setStatusMessage({
    title: "Loading RFP data...",
    body: "Pulling the JSON capsule and preparing draft deliverables.",
    variant: "info"
  });

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }
    const json = await response.json();
    state.rfp = json;
    state.sourceUrl = url;

    const proposal = buildProposal(json, url);
    state.proposal = proposal;

    updateOutputs(proposal);
    setStatusMessage({
      title: "Proposal scaffold ready",
      body: "Summary below is ready for tailoring.",
      variant: "success"
    });
    renderSummary(json, proposal.summary, url);
  } catch (error) {
    console.error("Unable to load RFP", error);
    setStatusMessage({
      title: "Unable to load RFP",
      body: error.message || "Check the JSON URL and try again.",
      variant: "error"
    });
  }
}

function setupCopyHandlers() {
  document.addEventListener("click", async (event) => {
    const trigger = event.target.closest(".copy-btn");
    if (!trigger) {
      return;
    }
    const targetId = trigger.getAttribute("data-target");
    if (!targetId) {
      return;
    }
    const field = document.getElementById(targetId);
    if (!field) {
      return;
    }
    try {
      await navigator.clipboard.writeText(field.value || "");
      trigger.classList.add("active");
      trigger.textContent = "Copied";
      setTimeout(() => {
        trigger.classList.remove("active");
        trigger.textContent = "Copy";
      }, 2000);
    } catch (err) {
      console.error("Clipboard failure", err);
      trigger.textContent = "Copy failed";
    }
  });
}

function setupN8nHandlers() {
  const sendButton = document.getElementById("send-n8n");
  const n8nStatus = document.getElementById("n8n-status");
  const urlInput = document.getElementById("n8n-url");
  const n8nOutput = document.getElementById("n8n-output");
  const clearButton = document.getElementById("clear-n8n-output");

  if (!sendButton) {
    return;
  }

  if (clearButton && n8nOutput) {
    clearButton.addEventListener("click", () => {
      n8nOutput.value = "";
      updateN8nStatus("n8n response cleared.", "info");
      n8nOutput.focus();
    });
  }

  if (urlInput && state.n8nUrl) {
    urlInput.value = state.n8nUrl;
  }

  if (n8nStatus && state.n8nUrl) {
    n8nStatus.textContent = "Ready to deliver to ACME n8n test hook.";
    n8nStatus.className = "hint status-info";
  }

  sendButton.addEventListener("click", async () => {
    if (!state.proposal) {
      updateN8nStatus("Load the RFP before sending.", "error");
      return;
    }

    const targetUrl = (urlInput?.value || "").trim();
    if (!targetUrl) {
      updateN8nStatus("Provide an n8n webhook URL.", "error");
      if (urlInput) {
        urlInput.focus();
      }
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl, window.location.href);
    } catch (error) {
      updateN8nStatus("Enter a valid webhook URL (example: http://localhost:5678/webhook-test/10b9cd18-a9bf-4464-a202-141f3bd3e8cf).", "error");
      if (urlInput) {
        urlInput.focus();
      }
      return;
    }

    if (window.location.protocol === "https:" && parsedUrl.protocol === "http:") {
      updateN8nStatus("This page runs over HTTPS. Browsers block HTTP webhook calls - use an HTTPS n8n URL or open this page locally over HTTP.", "error");
      return;
    }

    state.n8nUrl = parsedUrl.href;

    sendButton.disabled = true;
    sendButton.textContent = "Sending...";
    updateN8nStatus("Posting structured payload to n8n...", "info");

    try {
      const response = await fetch(parsedUrl.href, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(state.proposal.structured)
      });

      const contentType = response.headers.get("content-type") || "";
      const rawBody = await response.text();
      const formattedBody = formatN8nPayload(rawBody, contentType);
      const statusLabel = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;

      if (!response.ok) {
        updateN8nStatus(`${statusLabel}.`, "error");
        const message = formattedBody
          ? `n8n responded with ${statusLabel}
${formattedBody}`
          : `n8n responded with ${statusLabel}`;
        updateN8nResponse(message);
        return;
      }

      updateN8nStatus("Payload delivered to n8n.", "success");
      recordN8nDelivery({
        statusLabel,
        rawBody,
        formattedBody,
        contentType,
        sourceUrl: state.sourceUrl,
        proposal: state.proposal
      });
      const message = formattedBody
        ? `n8n responded with ${statusLabel}
${formattedBody}`
        : `n8n responded with ${statusLabel} (no body)`;
      updateN8nResponse(message);
    } catch (error) {
      console.error("n8n send error", error);
      const detail = error.message || "Failed to reach n8n endpoint.";
      updateN8nStatus(detail, "error");
      updateN8nResponse(`n8n request failed: ${detail}`);
    } finally {
      sendButton.disabled = false;
      sendButton.textContent = "Send to n8n";
    }
  });

  function updateN8nStatus(message, variant) {
    if (!n8nStatus) {
      return;
    }
    n8nStatus.textContent = message;
    n8nStatus.className = `hint status-${variant}`;
  }

  function updateN8nResponse(message, { append = true } = {}) {
    if (!n8nOutput || !message) {
      return;
    }
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${message}`.trim();
    if (append && n8nOutput.value.trim()) {
      n8nOutput.value = `${n8nOutput.value.trimEnd()}

${formatted}`;
    } else {
      n8nOutput.value = formatted;
    }
    n8nOutput.scrollTop = n8nOutput.scrollHeight;
  }

  function formatN8nPayload(raw, contentType) {
    if (!raw) {
      return "";
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return "";
    }
    const isJson = (contentType || "").toLowerCase().includes("application/json");
    if (isJson) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
      } catch (error) {
        return trimmed;
      }
    }
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      return trimmed;
    }
  }
}

function recordN8nDelivery(details) {
  if (!details) {
    return;
  }
  const entry = buildDeliveryRecord(details);
  if (!entry) {
    return;
  }
  state.deliveries.unshift(entry);
  if (state.deliveries.length > 5) {
    state.deliveries.length = 5;
  }
  renderDeliveryFeed();
}

function renderDeliveryFeed() {
  const feed = document.getElementById("n8n-delivery-feed");
  if (!feed) {
    return;
  }

  feed.innerHTML = "";
  if (!state.deliveries.length) {
    feed.classList.add("delivery-feed--empty");
    const placeholder = document.createElement("p");
    placeholder.className = "hint";
    placeholder.textContent = "Proposals pushed back from n8n will appear here once available.";
    feed.appendChild(placeholder);
    return;
  }

  feed.classList.remove("delivery-feed--empty");

  state.deliveries.forEach((delivery, index) => {
    const entry = document.createElement("div");
    entry.className = "delivery-entry";

    const header = document.createElement("div");
    header.className = "delivery-entry__header";

    const info = document.createElement("div");
    info.className = "delivery-entry__info";

    const badge = document.createElement("span");
    badge.className = "delivery-entry__badge";
    badge.textContent = index === 0 ? "Latest delivery" : `Delivery ${index + 1}`;
    info.appendChild(badge);

    const metaRow = document.createElement("div");
    metaRow.className = "delivery-entry__meta";

    if (delivery.statusLabel) {
      const status = document.createElement("span");
      status.className = "delivery-entry__status";
      status.textContent = delivery.statusLabel;
      metaRow.appendChild(status);
    }

    if (delivery.contentType) {
      const type = document.createElement("span");
      type.className = "delivery-entry__time";
      type.textContent = delivery.contentType;
      metaRow.appendChild(type);
    }

    const time = document.createElement("span");
    time.className = "delivery-entry__time";
    time.textContent = formatDeliveryTimestamp(delivery.timestamp);
    metaRow.appendChild(time);

    info.appendChild(metaRow);
    header.appendChild(info);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.setAttribute("data-target", delivery.textareaId);
    copyBtn.textContent = "Copy Payload";
    header.appendChild(copyBtn);

    entry.appendChild(header);

    if (delivery.synopsis) {
      const synopsis = document.createElement("p");
      synopsis.className = "delivery-entry__summary";
      synopsis.textContent = delivery.synopsis;
      entry.appendChild(synopsis);
    }

    const chips = buildDeliveryChips(delivery);
    if (chips) {
      entry.appendChild(chips);
    }

    const payloadField = document.createElement("textarea");
    payloadField.id = delivery.textareaId;
    payloadField.readOnly = true;
    payloadField.value = delivery.formattedBody || "";
    entry.appendChild(payloadField);

    feed.appendChild(entry);
  });
}

function buildDeliveryRecord({ rawBody, formattedBody, contentType, statusLabel, proposal, sourceUrl }) {
  const timestamp = new Date();
  const parsed = parseN8nPayload(rawBody, contentType);
  const formatted = (formattedBody || "").trim();
  const primaryText = extractPrimaryText(parsed) || (formatted.length ? formatted : "");
  const synopsis = deriveDeliverySynopsis(parsed, primaryText);
  const baseId = getDeliveryFieldId();
  const summary = proposal?.summary || {};

  return {
    id: baseId,
    textareaId: `${baseId}-payload`,
    timestamp,
    statusLabel: statusLabel || "HTTP 200",
    contentType: contentType || "",
    programName: normalisePlaceholder(summary.program),
    solicitation: normalisePlaceholder(summary.solicitation),
    responseDue: normalisePlaceholder(summary.responseDue),
    sourceUrl,
    synopsis: truncateText(synopsis, 320),
    formattedBody: formatted || formattedBody || "",
    primaryText,
    parsed
  };
}

function deriveDeliverySynopsis(parsed, primaryText) {
  if (parsed && typeof parsed === "object") {
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      return parsed.summary.trim();
    }
    if (parsed.summary && typeof parsed.summary.headline === "string" && parsed.summary.headline.trim()) {
      return parsed.summary.headline.trim();
    }
    if (typeof parsed.headline === "string" && parsed.headline.trim()) {
      return parsed.headline.trim();
    }
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      return parsed.title.trim();
    }
  }
  return primaryText;
}

function buildDeliveryChips(delivery) {
  const items = [];
  if (delivery.programName) {
    items.push({ label: "Program", value: delivery.programName });
  }
  if (delivery.solicitation) {
    items.push({ label: "Solicitation", value: delivery.solicitation });
  }
  if (delivery.responseDue) {
    items.push({ label: "Due", value: delivery.responseDue });
  }
  if (delivery.sourceUrl) {
    items.push({ label: "Source", value: delivery.sourceUrl, href: delivery.sourceUrl });
  }

  if (!items.length) {
    return null;
  }

  const container = document.createElement("div");
  container.className = "delivery-entry__chips";

  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "delivery-entry__chip";
    chip.append(document.createTextNode(`${item.label}: `));
    if (item.href) {
      const link = document.createElement("a");
      link.href = item.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = item.value;
      chip.append(link);
    } else {
      chip.append(document.createTextNode(item.value));
    }
    container.appendChild(chip);
  });

  return container;
}

function parseN8nPayload(rawBody, contentType) {
  if (!rawBody) {
    return null;
  }
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return null;
  }
  const lower = (contentType || "").toLowerCase();
  const expectsJson = lower.includes("application/json") || lower.includes("text/json");
  if (expectsJson) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return null;
  }
}

function extractPrimaryText(value) {
  if (!value) {
    return "";
  }
  const priority = new Set(["proposalnarrative", "proposaltext", "proposal", "narrative", "narrativebody", "markdown", "md", "text", "body", "content"]);
  let preferred = "";
  let fallback = "";
  const queue = [value];
  const visited = new Set();
  let iterations = 0;

  while (queue.length && iterations < 200) {
    const current = queue.shift();
    iterations += 1;
    if (!current) {
      continue;
    }

    if (typeof current === "string") {
      const text = current.trim();
      if (!text) {
        continue;
      }
      if (text.length > fallback.length) {
        fallback = text;
      }
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
      continue;
    }

    Object.entries(current).forEach(([key, item]) => {
      if (typeof item === "string") {
        const text = item.trim();
        if (!text) {
          return;
        }
        const keyName = key.toLowerCase();
        if (priority.has(keyName) && text.length >= 40) {
          if (text.length > preferred.length) {
            preferred = text;
          }
        }
        if (text.length > fallback.length) {
          fallback = text;
        }
      } else if (item && typeof item === "object") {
        queue.push(item);
      }
    });
  }

  return preferred || fallback;
}

function formatDeliveryTimestamp(date) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch (error) {
    return date.toLocaleString();
  }
}

function normalisePlaceholder(value) {
  if (!value) {
    return "";
  }
  const trimmed = String(value).trim();
  if (!trimmed || trimmed.startsWith("[")) {
    return "";
  }
  return trimmed;
}

function truncateText(value, maxLength = 320) {
  if (!value) {
    return "";
  }
  const text = value.trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}
function getDeliveryFieldId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `delivery-${crypto.randomUUID()}`;
  }
  return `delivery-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}
function updateOutputs(proposal) {
  const textField = document.getElementById("text-output");
  const markdownField = document.getElementById("markdown-output");
  const jsonField = document.getElementById("json-output");

  if (textField) {
    textField.value = proposal.text;
  }
  if (markdownField) {
    markdownField.value = proposal.markdown;
  }
  if (jsonField) {
    jsonField.value = proposal.json;
  }
}

function renderSummary(rfpData, summary, sourceUrl) {
  const panel = document.getElementById("status-panel");
  if (panel) {
    panel.setAttribute("data-variant", "success");
  }
  const summaryContainer = ensureSummaryContainer();
  if (!summaryContainer) {
    return;
  }

  const meta = rfpData.metadata || {};
  const contact = (rfpData.pointsOfContact || [])[0] || {};
  const focusChips = (summary.focusAreas || []).map((item) => `<span>${item}</span>`).join("");

  summaryContainer.innerHTML = `
    <h2>${summary.program || "RFP"} ingest complete</h2>
    <div class="summary-grid">
      <div><span>Solicitation</span><strong>${meta.solicitationNumber || "[TBD]"}</strong></div>
      <div><span>Response Due</span><strong>${meta.responseDue || "[MM/DD/YYYY HHMM CT]"}</strong></div>
      <div><span>Primary POC</span><strong>${contact.name || "[Name]"}</strong></div>
      <div><span>JSON Source</span><strong><a href="${sourceUrl}" target="_blank" rel="noopener">${sourceUrl}</a></strong></div>
    </div>
    <p class="summary-lead">${summary.headline}</p>
    <div class="summary-chips">${focusChips}</div>
  `;
}

function setStatusMessage({ title, body, variant }) {
  const panel = document.getElementById("status-panel");
  if (!panel) {
    return;
  }
  panel.setAttribute("data-variant", variant || "info");
  const summaryContainer = ensureSummaryContainer();
  if (!summaryContainer) {
    return;
  }
  const parts = [];
  if (title) {
    parts.push(`<h2>${title}</h2>`);
  }
  if (body) {
    parts.push(`<p>${body}</p>`);
  }
  summaryContainer.innerHTML = parts.join("") || "<h2>Status</h2>";
}

function ensureSummaryContainer() {
  const panel = document.getElementById("status-panel");
  if (!panel) {
    return null;
  }
  let summaryContainer = panel.querySelector("#rfp-summary");
  if (!summaryContainer) {
    summaryContainer = document.createElement("div");
    summaryContainer.id = "rfp-summary";
    summaryContainer.className = "rfp-summary";
    panel.innerHTML = "";
    panel.appendChild(summaryContainer);
  }
  return summaryContainer;
}

function buildProposal(data, sourceUrl) {
  const markdown = data.markdown || "";
  const meta = data.metadata || {};

  const overview = extractParagraphs(getSection(markdown, "Section A - Overview"));
  const focusAreas = parseOrderedHighlights(getSection(markdown, "C.2 Concept of Operations (CONOPS) - In Scope"));
  const requirements = parseRequirements(getSection(markdown, "C.5 Technical Requirements (Minimum)"));
  const deliverables = parseDeliverables(getSection(markdown, "C.7 Deliverables (Data Rights in Section H)"));
  const schedule = parseSchedule(getSection(markdown, "Section F - Deliveries or Performance (Schedule)"));
  const evaluation = parseEvaluation(getSection(markdown, "Section M - Evaluation Factors for Award"));

  const headline = overview[0] || "Draft response prepared for the AI Acquisition Automation Program.";
  const summary = {
    program: data.program || "AI Acquisition Automation Program",
    headline,
    focusAreas: focusAreas.map((item) => item.title).slice(0, 4)
  };

  const text = renderPlainText({
    program: summary.program,
    overview,
    focusAreas,
    requirements,
    deliverables,
    schedule,
    evaluation
  });

  const markdownDraft = renderMarkdown({
    program: summary.program,
    meta,
    overview,
    focusAreas,
    requirements,
    deliverables,
    schedule,
    evaluation
  });

  const payload = buildJsonPayload({
    data,
    sourceUrl,
    overview,
    focusAreas,
    requirements,
    deliverables,
    schedule,
    evaluation
  });

  return {
    text,
    markdown: markdownDraft,
    json: JSON.stringify(payload, null, 2),
    structured: payload,
    summary: {
      ...summary,
      solicitation: meta.solicitationNumber || "[TBD]",
      responseDue: meta.responseDue || "[MM/DD/YYYY HHMM CT]"
    }
  };
}

function renderPlainText({ program, overview, focusAreas, requirements, deliverables, schedule, evaluation }) {
  const lines = [];
  lines.push(`${program} - Proposal Draft`);
  lines.push("");
  lines.push("Executive Summary:");
  overview.slice(0, 2).forEach((paragraph) => {
    lines.push(` ${paragraph}`);
  });
  lines.push("");
  lines.push("Solution Highlights:");
  focusAreas.forEach((item) => {
    lines.push(` - ${item.title}: ${item.summary}`);
    item.points.forEach((point) => {
      lines.push(`   * ${point}`);
    });
  });
  lines.push("");
  lines.push("Requirement Alignment (R1-R10):");
  requirements.forEach((req) => {
    lines.push(` - ${req.title}: ${req.statement}`);
    req.subpoints.forEach((point) => {
      lines.push(`   * ${point}`);
    });
  });
  lines.push("");
  lines.push("Deliverables & Transition:");
  deliverables.forEach((item) => {
    lines.push(` - ${item}`);
  });
  lines.push("");
  lines.push("Implementation Timeline:");
  schedule.rows.forEach((row) => {
    lines.push(` - ${row.Milestone} (${row.Due}): ${row.Description}`);
  });
  lines.push("");
  lines.push("Evaluation Positioning:");
  evaluation.forEach((item) => {
    lines.push(` - ${item}`);
  });
  lines.push("");
  lines.push("Next Steps:");
  lines.push(" - Review with stakeholders and update placeholders (CLIN pricing, due dates, named personnel).");
  lines.push(" - Trigger n8n workflow to generate formatted deliverables and SSA-ready narratives.");
  lines.push(" - Integrate compliance evidence (RMF, CMMC, SBOM) ahead of submission.");

  return lines.join("\n");
}

function renderMarkdown({ program, meta, overview, focusAreas, requirements, deliverables, schedule, evaluation }) {
  const lines = [];
  lines.push(`# ${program} - Proposal Draft`);
  lines.push("");
  lines.push(`**Solicitation:** ${meta.solicitationNumber || "[TBD]"}`);
  lines.push(`**Response Due:** ${meta.responseDue || "[MM/DD/YYYY HHMM CT]"}`);
  lines.push("");
  lines.push("## Executive Summary");
  overview.slice(0, 2).forEach((paragraph) => lines.push(paragraph));
  lines.push("");
  lines.push("## Solution Highlights");
  focusAreas.forEach((item) => {
    lines.push(`- **${item.title}:** ${item.summary}`);
    item.points.forEach((point) => {
      lines.push(`  - ${point}`);
    });
  });
  lines.push("");
  lines.push("## Requirement Alignment");
  requirements.forEach((req) => {
    lines.push(`- **${req.title}:** ${req.statement}`);
    req.subpoints.forEach((point) => {
      lines.push(`  - ${point}`);
    });
  });
  lines.push("");
  lines.push("## Deliverables");
  deliverables.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("## Implementation Timeline");
  lines.push(`| Milestone | Description | Due |`);
  lines.push(`| --------- | ----------- | --- |`);
  schedule.rows.forEach((row) => {
    lines.push(`| ${row.Milestone} | ${row.Description} | ${row.Due} |`);
  });
  lines.push("");
  lines.push("## Evaluation Positioning");
  evaluation.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("## Automation Next Steps");
  lines.push("- Run n8n proposal agent to merge data into customer-facing artifacts.");
  lines.push("- Insert verified pricing, staffing, and compliance references.");
  lines.push("- Schedule internal color team review prior to submission.");

  return lines.join("\n");
}

function buildJsonPayload({ data, sourceUrl, overview, focusAreas, requirements, deliverables, schedule, evaluation }) {
  const meta = data.metadata || {};
  return {
    program: data.program || "AI Acquisition Automation Program",
    solicitationNumber: meta.solicitationNumber || "[TBD]",
    responseDue: meta.responseDue || "[MM/DD/YYYY HHMM CT]",
    contacts: data.pointsOfContact || [],
    executiveSummary: overview.slice(0, 2),
    solutionHighlights: focusAreas.map((item) => ({
      area: item.title,
      summary: item.summary,
      supportingActions: item.points
    })),
    requirementsAlignment: requirements.map((req) => ({
      requirement: req.title,
      approach: req.statement,
      supportingDetails: req.subpoints
    })),
    deliverables,
    schedule: schedule.rows,
    evaluationFocus: evaluation,
    source: {
      json: sourceUrl,
      generatedAt: new Date().toISOString()
    }
  };
}

function extractParagraphs(section) {
  if (!section) {
    return [];
  }
  return section
    .split(/\n\s*\n/)
    .map((block) => normaliseWhitespace(block))
    .filter(Boolean);
}

function parseOrderedHighlights(section) {
  if (!section) {
    return [];
  }
  const lines = section.split("\n");
  const items = [];
  let current = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const orderedMatch = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*/);
    if (orderedMatch) {
      if (current) {
        items.push(current);
      }
      const summaryText = trimmed.replace(orderedMatch[0], "").trim().replace(/^[-:]+\s*/, "");
      current = {
        index: Number(orderedMatch[1]),
        title: orderedMatch[2].trim(),
        summary: summaryText || "Capability delivered per CONOPS objective.",
        points: []
      };
      return;
    }

    if (trimmed.startsWith("- ") && current) {
      current.points.push(trimmed.slice(2).trim());
    }
  });

  if (current) {
    items.push(current);
  }

  return items;
}

function parseRequirements(section) {
  if (!section) {
    return [];
  }
  const lines = section.split("\n");
  const items = [];
  let current = null;

  lines.forEach((line) => {
    if (line.startsWith("- **")) {
      if (current) {
        items.push(current);
      }
      const match = line.match(/^- \*\*(.+?)\*\*\s*(.*)$/);
      const title = match ? match[1].replace(/:$/, "").trim() : line.slice(2).trim();
      const statement = match ? normaliseWhitespace(match[2]) : "";
      current = {
        title,
        statement: statement || "Our solution addresses this requirement through configurable automation modules.",
        subpoints: []
      };
    } else if (line.startsWith("  - ") && current) {
      current.subpoints.push(normaliseWhitespace(line.slice(4)));
    }
  });

  if (current) {
    items.push(current);
  }

  return items;
}

function parseDeliverables(section) {
  if (!section) {
    return [];
  }
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => normaliseWhitespace(line.slice(2)));
}

function parseSchedule(section) {
  const rows = [];
  if (!section) {
    return { headers: [], rows };
  }
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (lines.length < 2) {
    return { headers: [], rows };
  }
  const headers = splitTableRow(lines[0]);
  lines.slice(2).forEach((line) => {
    const cells = splitTableRow(line);
    if (cells.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index];
      });
      rows.push(row);
    }
  });
  return { headers, rows };
}

function parseEvaluation(section) {
  if (!section) {
    return [];
  }
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.match(/^\d+\./));
  return lines.map((line) => line.replace(/^[-\d\.\s]+/, "").trim());
}

function splitTableRow(row) {
  return row
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function getSection(markdown, heading) {
  if (!markdown) {
    return "";
  }
  const escaped = escapeRegex(heading);
  const regex = new RegExp(`^(#{1,6})\s+${escaped}\s*$`, "m");
  const match = regex.exec(markdown);
  if (!match) {
    return "";
  }
  const headingLevel = match[1].length;
  const startIndex = match.index + match[0].length;
  const remainder = markdown.slice(startIndex);
  const headingRegex = /^#{1,6}\s+/gm;
  let nextIndex = remainder.length;
  let headingMatch;
  while ((headingMatch = headingRegex.exec(remainder)) !== null) {
    const level = headingMatch[0].trim().length;
    if (level <= headingLevel) {
      nextIndex = headingMatch.index;
      break;
    }
  }
  return remainder.slice(0, nextIndex).trim();
}

function normaliseWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}



































