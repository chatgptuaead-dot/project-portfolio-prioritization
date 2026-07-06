(function () {
  "use strict";

  const STORAGE_KEY = "budgetTriage.projects.v1";
  const DEFAULT_NEW_SECTION = "optimize"; // easy-to-change config constant (see PRD 3.1)
  const SECTIONS = ["keep", "optimize", "close"];

  /** @type {{id:string, name:string, min:number, max:number, section:string}[]} */
  let projects = [];
  let editingId = null;

  // ---------- Persistence ----------

  function loadProjects() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      projects = [];
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) projects = parsed;
    } catch (e) {
      projects = [];
    }
  }

  function saveProjects() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }

  function makeId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ---------- Budget parsing & formatting ----------

  function parseBudgetInput(raw) {
    const cleaned = raw.trim().replace(/–/g, "-"); // normalize en dash to hyphen
    if (cleaned === "") return { error: "Budget is required." };

    const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      let min = parseFloat(rangeMatch[1]);
      let max = parseFloat(rangeMatch[2]);
      if (min > max) [min, max] = [max, min];
      return { min, max };
    }

    const singleMatch = cleaned.match(/^(\d+(?:\.\d+)?)$/);
    if (singleMatch) {
      const n = parseFloat(singleMatch[1]);
      return { min: n, max: n };
    }

    return { error: "Enter a number (e.g. 8) or a range (e.g. 5-10)." };
  }

  function formatNum(n) {
    // strip unnecessary trailing zeros, keep decimals the user entered
    return Number(n.toFixed(2)).toString();
  }

  function formatMoney(n) {
    return `$${formatNum(n)}M`;
  }

  function formatRange(lo, hi) {
    return `$${formatNum(lo)}-${formatNum(hi)}M`;
  }

  function displayedValue(project) {
    if (project.section === "keep") return formatMoney(project.max);
    if (project.section === "optimize") {
      // A project moved in from Close is valued at its higher number;
      // otherwise Optimize shows the full entered range.
      if (project.fromClose) return formatMoney(project.max);
      return project.min === project.max ? formatMoney(project.min) : formatRange(project.min, project.max);
    }
    // Close: show the exact 0-based range as entered (0-max when min is
    // already 0), or 0-min when the range was reduced down from a higher min.
    const top = project.min > 0 ? project.min : project.max;
    return formatRange(0, top);
  }

  function contributionToTotal(project) {
    if (project.section === "keep") return project.max;
    if (project.section === "optimize") return project.fromClose ? project.max : project.min;
    return project.min > 0 ? project.min : project.max; // close -> top of the 0-based range
  }

  // ---------- Rendering ----------

  function render() {
    let grandTotal = 0;

    SECTIONS.forEach((section) => {
      const listEl = document.getElementById(`list-${section}`);
      const items = projects.filter((p) => p.section === section);

      listEl.innerHTML = "";
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No projects yet";
        listEl.appendChild(empty);
      } else {
        items.forEach((p) => listEl.appendChild(renderCard(p)));
      }

      document.getElementById(`count-${section}`).textContent = String(items.length);

      const total = items.reduce((sum, p) => sum + contributionToTotal(p), 0);
      document.getElementById(`total-${section}`).textContent = formatMoney(total);
      grandTotal += total;
    });

    document.getElementById("grand-total").textContent = formatMoney(grandTotal);
  }

  function renderCard(project) {
    const card = document.createElement("div");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = project.id;

    card.innerHTML = `
      <div class="card__top">
        <div class="card__handle" aria-hidden="true">⠿</div>
        <div class="card__name" title=""></div>
        <div class="card__budget"></div>
        <div class="card__actions">
          <button class="card__icon-btn" data-action="edit" title="Edit">✎</button>
          <button class="card__icon-btn" data-action="delete" title="Delete">✕</button>
        </div>
      </div>
    `;
    card.querySelector(".card__name").textContent = project.name;
    card.querySelector(".card__name").title = project.name;
    card.querySelector(".card__budget").textContent = displayedValue(project);

    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", project.id);
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));

    card.querySelector('[data-action="edit"]').addEventListener("click", () => openEditModal(project.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteProject(project.id));
    card.querySelector(".card__handle").addEventListener("touchstart", (e) => handleTouchDragStart(e, card, project.id), { passive: false });

    return card;
  }

  // ---------- Touch drag and drop (mobile) ----------

  let touchGhost = null;
  let touchDraggingId = null;

  function handleTouchDragStart(e, card, projectId) {
    e.preventDefault();
    const touch = e.touches[0];
    touchDraggingId = projectId;
    card.classList.add("dragging");

    const rect = card.getBoundingClientRect();
    touchGhost = card.cloneNode(true);
    touchGhost.classList.add("card--ghost");
    touchGhost.style.width = `${rect.width}px`;
    touchGhost.style.left = `${rect.left}px`;
    touchGhost.style.top = `${rect.top}px`;
    document.body.appendChild(touchGhost);

    const offsetX = touch.clientX - rect.left;
    const offsetY = touch.clientY - rect.top;

    function moveGhost(clientX, clientY) {
      touchGhost.style.left = `${clientX - offsetX}px`;
      touchGhost.style.top = `${clientY - offsetY}px`;
    }

    function findColumnAt(x, y) {
      touchGhost.style.display = "none";
      const el = document.elementFromPoint(x, y);
      touchGhost.style.display = "";
      return el ? el.closest(".column") : null;
    }

    function onTouchMove(ev) {
      ev.preventDefault();
      const t = ev.touches[0];
      moveGhost(t.clientX, t.clientY);

      const column = findColumnAt(t.clientX, t.clientY);
      document.querySelectorAll(".column").forEach((c) => c.classList.toggle("drag-over", c === column));
    }

    function onTouchEnd(ev) {
      const t = ev.changedTouches[0];
      const column = findColumnAt(t.clientX, t.clientY);
      document.querySelectorAll(".column").forEach((c) => c.classList.remove("drag-over"));

      if (column) moveProject(touchDraggingId, column.dataset.section);

      card.classList.remove("dragging");
      touchGhost.remove();
      touchGhost = null;
      touchDraggingId = null;
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    }

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
  }

  // ---------- Drag and drop on columns ----------

  function setupColumnDropzones() {
    document.querySelectorAll(".column").forEach((column) => {
      const section = column.dataset.section;

      column.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        column.classList.add("drag-over");
      });

      column.addEventListener("dragleave", (e) => {
        if (!column.contains(e.relatedTarget)) column.classList.remove("drag-over");
      });

      column.addEventListener("drop", (e) => {
        e.preventDefault();
        column.classList.remove("drag-over");
        const id = e.dataTransfer.getData("text/plain");
        moveProject(id, section);
      });
    });
  }

  function moveProject(id, section) {
    const project = projects.find((p) => p.id === id);
    if (!project || project.section === section) return;
    project.fromClose = section === "optimize" && project.section === "close";
    project.section = section;
    saveProjects();
    render();
  }

  function deleteProject(id) {
    projects = projects.filter((p) => p.id !== id);
    saveProjects();
    render();
  }

  // ---------- Modal (add / edit) ----------

  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const projectForm = document.getElementById("projectForm");
  const nameInput = document.getElementById("nameInput");
  const budgetInput = document.getElementById("budgetInput");
  const nameError = document.getElementById("nameError");
  const budgetError = document.getElementById("budgetError");
  const saveBtn = document.getElementById("saveBtn");

  function openAddModal() {
    editingId = null;
    modalTitle.textContent = "Add Project";
    saveBtn.textContent = "Add Project";
    nameInput.value = "";
    budgetInput.value = "";
    clearErrors();
    modalOverlay.classList.add("open");
    nameInput.focus();
  }

  function openEditModal(id) {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    editingId = id;
    modalTitle.textContent = "Edit Project";
    saveBtn.textContent = "Save Changes";
    nameInput.value = project.name;
    budgetInput.value = project.min === project.max ? formatNum(project.min) : `${formatNum(project.min)}-${formatNum(project.max)}`;
    clearErrors();
    modalOverlay.classList.add("open");
    nameInput.focus();
  }

  function closeModal() {
    modalOverlay.classList.remove("open");
  }

  function clearErrors() {
    nameError.textContent = "";
    budgetError.textContent = "";
  }

  document.getElementById("addProjectBtn").addEventListener("click", openAddModal);
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  projectForm.addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors();

    const name = nameInput.value.trim();
    let hasError = false;

    if (!name) {
      nameError.textContent = "Name is required.";
      hasError = true;
    }

    const parsed = parseBudgetInput(budgetInput.value);
    if (parsed.error) {
      budgetError.textContent = parsed.error;
      hasError = true;
    } else if (parsed.min < 0 || parsed.max < 0) {
      budgetError.textContent = "Budget cannot be negative.";
      hasError = true;
    }

    if (hasError) return;

    if (editingId) {
      const project = projects.find((p) => p.id === editingId);
      project.name = name;
      project.min = parsed.min;
      project.max = parsed.max;
      if (parsed.min === 0) {
        project.section = "close"; // re-run auto-route rule (PRD 3.4)
        project.fromClose = false;
      }
    } else {
      const section = parsed.min === 0 ? "close" : DEFAULT_NEW_SECTION;
      projects.push({ id: makeId(), name, min: parsed.min, max: parsed.max, section, fromClose: false });
    }

    saveProjects();
    render();
    closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("open")) closeModal();
  });

  // ---------- Init ----------

  loadProjects();
  setupColumnDropzones();
  render();
})();
