document.addEventListener("DOMContentLoaded", () => {
  const box = document.getElementById("rfp-box");
  const loading = document.getElementById("rfp-loading");
  const metaPanel = document.getElementById("rfp-meta");
  const copyButton = document.getElementById("copy-json");
  const source = box?.dataset?.source || "rfp.json";
  const absoluteJsonUrl = new URL(source, window.location.href).href;

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(absoluteJsonUrl);
        copyButton.textContent = "Copied JSON URL";
        copyButton.classList.add("active");
        setTimeout(() => {
          copyButton.textContent = "Copy JSON URL";
          copyButton.classList.remove("active");
        }, 2400);
      } catch (err) {
        console.error("Clipboard error", err);
        copyButton.textContent = "Copy not available";
      }
    });
  }

  fetch(source)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load RFP data: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (loading) {
        loading.remove();
      }
      renderMeta(metaPanel, data, absoluteJsonUrl);
      box.innerHTML = data.html;
      applyHeadingAnchors(box, data.headings || []);
    })
    .catch((error) => {
      console.error(error);
      if (loading) {
        loading.textContent = "Unable to load RFP data.";
      }
    });
});

function renderMeta(container, data, jsonUrl) {
  if (!container) {
    return;
  }

  const meta = data.metadata || {};
  const contacts = data.pointsOfContact || [];
  const headings = (data.headings || []).filter((h) => h.level === 2);

  const metaItems = [
    createMetaItem("Solicitation No.", meta.solicitationNumber || "[TBD]"),
    createMetaItem("Issue Date", meta.issueDate || "[TBD]"),
    createMetaItem("Response Due", meta.responseDue || "[MM/DD/YYYY HHMM CT]")
  ];

  const contactMarkup = contacts
    .map((contact) => {
      const email = contact.email ? contact.email.replace(/^mailto:/i, "") : "";
      const emailLink = email
        ? `<a href="mailto:${email}">${email}</a>`
        : "[email@domain.mil]";
      return `
        <div class="meta-item">
          <span>${contact.label || "POC"}</span>
          <span>${contact.name || "[Name]"}</span>
          <span>${contact.role || ""}</span>
          <span>${emailLink}</span>
        </div>`;
    })
    .join("");

  const headingLinks = headings
    .map((heading) => `<li><a href="#${heading.anchor}">${heading.title}</a></li>`)
    .join("");

  container.innerHTML = `
    <h3>RFP Snapshot</h3>
    <div class="meta-grid">
      ${metaItems.join("")}
    </div>
    <h4>Points of Contact</h4>
    <div class="meta-grid contacts">
      ${contactMarkup}
    </div>
    <h4>Top-Level Sections</h4>
    <ul class="section-list">${headingLinks}</ul>
    <p class="disclaimer">${data.disclaimer || ""}</p>
    <p class="json-url"><strong>JSON endpoint:</strong> <a href="${jsonUrl}">${jsonUrl}</a></p>
  `;
}

function createMetaItem(label, value) {
  return `
    <div class="meta-item">
      <span>${label}</span>
      <span>${value}</span>
    </div>`;
}

function applyHeadingAnchors(container, headings) {
  if (!container) {
    return;
  }
  const headingElements = container.querySelectorAll("h1, h2, h3, h4");
  const queue = [...headings];
  headingElements.forEach((element) => {
    const next = queue.shift();
    if (next && next.anchor) {
      element.id = next.anchor;
    }
  });
}
