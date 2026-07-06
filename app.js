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
    if (project.section === "optimize") return formatMoney(project.min);
    return formatRange(0, project.min);
  }

  function contributionToTotal(project) {
    if (project.section === "keep") return project.max;
    return project.min; // optimize -> min, close -> min (top end of 0-min range)
  }

  // ---------- Rendering ----------

  function render() {
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
    });
  }

  function renderCard(project) {
    const card = document.createElement("div");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = project.id;

    card.innerHTML = `
      <div class="card__top">
        <div class="card__name"></div>
        <div class="card__actions">
          <button class="card__icon-btn" data-action="edit" title="Edit">✎</button>
          <button class="card__icon-btn" data-action="delete" title="Delete">✕</button>
        </div>
      </div>
      <div class="card__budget"></div>
    `;
    card.querySelector(".card__name").textContent = project.name;
    card.querySelector(".card__budget").textContent = displayedValue(project);

    card.addEventListener("dragstart", (e) => {
      card.classList.add("dragging");
      e.dataTransfer.setData("text/plain", project.id);
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));

    card.querySelector('[data-action="edit"]').addEventListener("click", () => openEditModal(project.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteProject(project.id));

    return card;
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
      if (parsed.min === 0) project.section = "close"; // re-run auto-route rule (PRD 3.4)
    } else {
      const section = parsed.min === 0 ? "close" : DEFAULT_NEW_SECTION;
      projects.push({ id: makeId(), name, min: parsed.min, max: parsed.max, section });
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
