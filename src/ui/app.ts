import type {
  CompletedRun,
  Difficulty,
  DifficultyFilter,
  Population,
  StudyAnswer,
  StudyQuestion,
  StudySnapshot,
} from "../domain/types";
import { DIFFICULTIES } from "../domain/types";
import {
  abandonActiveRun,
  answerActiveRun,
  createActiveRun,
  navigateActiveRun,
  runAnsweredCount,
  submitActiveRun,
} from "../domain/runs";
import { countEligible } from "../domain/selection";
import { deriveMetrics } from "../domain/metrics";
import {
  RecoveryNotFoundError,
  RecoveryReplacementRequiredError,
  RecoveryWriteConflictError,
  RevisionConflictError,
  StudyRepository,
  recoveryKeyForSnapshot,
} from "../adapters/indexeddb";
import { createStudyStore, StaleStudyStateError, type StudyStore } from "../application/store";
import {
  readSnapshotFile,
  saveSnapshotFile,
} from "../adapters/files";
import { validateSnapshot } from "../domain/validation";

type View = "empty" | "recoveries" | "study" | "exam" | "results" | "progress" | "module";
type NoticeKind = "success" | "warning" | "error";

interface NoticeState {
  kind: NoticeKind;
  title: string;
  detail: string;
  persistent?: boolean;
}

interface RecoveryLike {
  key: string;
  title?: string;
  subject?: string;
  stateRevision?: number;
  contentRevision?: number;
  updatedAt?: string;
  corrupt?: boolean;
  error?: string;
}

type Child = Node | string | number | null | undefined | false;
let inputSerial = 0;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    attrs?: Record<string, string>;
    data?: Record<string, string>;
    on?: Partial<Record<keyof HTMLElementEventMap, EventListener>>;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) element.setAttribute(name, value);
  for (const [name, value] of Object.entries(options.data ?? {})) element.dataset[name] = value;
  for (const [name, listener] of Object.entries(options.on ?? {})) {
    element.addEventListener(name, listener as EventListener);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function button(label: string, className: string, action: () => void | Promise<void>): HTMLButtonElement {
  return node("button", {
    className,
    text: label,
    attrs: { type: "button" },
    on: { click: () => void action() },
  });
}

function percent(value: number): string {
  return `${value.toFixed(1).replace(".0", "")}%`;
}

function difficultyLabel(value: Difficulty | DifficultyFilter): string {
  return {
    facil: "Fácil",
    medio: "Medio",
    dificil: "Difícil",
    experto: "Experto",
    mixta: "Aleatoria (mezcla de niveles)",
  }[value];
}

function formatDate(value: string | undefined | null): string {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function findQuestion(snapshot: StudySnapshot, id: string): StudyQuestion {
  const question = snapshot.questions.find((candidate) => candidate.id === id);
  if (!question) throw new Error(`La pregunta ${id} ya no existe en este módulo.`);
  return question;
}

export function requiresSeparateExistingBackup(
  currentKey: string | null,
  candidateKey: string,
  ownedWriteToken: number | null,
  observedWriteToken: number | null,
): boolean {
  return (
    currentKey !== candidateKey ||
    ownedWriteToken === null ||
    observedWriteToken === null ||
    ownedWriteToken !== observedWriteToken
  );
}

class Application {
  private root: HTMLElement;
  private repository!: StudyRepository;
  private store!: StudyStore;
  private snapshot: StudySnapshot | null = null;
  private recoveries: RecoveryLike[] = [];
  private view: View = "empty";
  private difficulty: DifficultyFilter = "mixta";
  private population: Population = "nuevas";
  private notice: NoticeState | null = null;
  private resultRun: CompletedRun | null = null;
  private volatile = false;
  private stale = false;
  private busy = false;
  private pendingMutations = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async init(): Promise<void> {
    try {
      this.repository = await StudyRepository.open();
      this.store = await createStudyStore(this.repository);
      this.store.subscribe((state) => {
        this.snapshot = state.snapshot;
        this.volatile = state.mode === "volatile";
        this.stale = state.mode === "stale";
        if (state.warning) {
          this.notice = {
            kind: state.mode === "stale" ? "error" : "warning",
            title: state.mode === "stale" ? "Otra pestaña avanzó este módulo" : "Cambios solo en memoria",
            detail: state.warning,
            persistent: true,
          };
        }
        if (this.root.childNodes.length) this.render();
      });
      this.recoveries = (await this.repository.listRecoveries()) as RecoveryLike[];
      this.view = this.recoveries.length ? "recoveries" : "empty";
      if (!this.repository.isPersistent) {
        this.notice = {
          kind: "warning",
          title: "Recuperación local no disponible",
          detail: this.repository.warning || "Exportá tu archivo después de estudiar para conservar el progreso.",
          persistent: true,
        };
      }
    } catch (error) {
      this.view = "empty";
      this.notice = {
        kind: "warning",
        title: "Este navegador no pudo abrir la recuperación local",
        detail: `${String(error)} Podés estudiar igual; exportá el módulo para conservar el progreso.`,
        persistent: true,
      };
    }
    this.render();
  }

  private setView(view: View, focus = true): void {
    this.view = view;
    if (view === "study" || view === "progress" || view === "module") {
      history.replaceState(null, "", `#${view === "study" ? "estudiar" : view === "progress" ? "progreso" : "modulo"}`);
    }
    this.render();
    if (focus) requestAnimationFrame(() => this.root.querySelector<HTMLElement>("h1")?.focus());
  }

  private async install(snapshot: StudySnapshot, expectedWriteToken: number | null): Promise<void> {
    await this.store.install(snapshot, expectedWriteToken);
    this.snapshot = this.store.getState().snapshot;
    this.volatile = this.store.getState().mode === "volatile";
    this.stale = this.store.getState().mode === "stale";
    this.notice = {
      kind: "success",
      title: "Módulo listo",
      detail: `${snapshot.questions.length} preguntas cargadas. El progreso del archivo se conservó exactamente.`,
    };
    this.setView(snapshot.progress.activeRun ? "study" : "study");
  }

  private async commit(mutation: (snapshot: StudySnapshot) => StudySnapshot, success?: string): Promise<StudySnapshot | null> {
    if (!this.snapshot || this.stale) return null;
    this.pendingMutations += 1;
    this.busy = true;
    this.render();
    try {
      const candidate = await this.store.commitMutation(mutation);
      this.snapshot = candidate;
      if (success) this.notice = { kind: "success", title: success, detail: "Guardado localmente." };
      return candidate;
    } catch (error) {
      if (error instanceof StaleStudyStateError) {
        this.stale = true;
        this.notice = {
          kind: "error",
          title: "Conflicto de recuperación",
          detail: "Otra pestaña cambió este módulo. Esta copia quedó en solo lectura; exportala como rescate o recargá.",
          persistent: true,
        };
        return null;
      }
      this.notice = {
        kind: "error",
        title: "No se pudo aplicar el cambio",
        detail: String(error),
      };
      return null;
    } finally {
      this.pendingMutations -= 1;
      this.busy = this.pendingMutations > 0;
      this.render();
    }
  }

  private render(): void {
    this.root.replaceChildren();
    if (!this.snapshot || this.view === "empty" || this.view === "recoveries") {
      this.root.append(this.renderEntry());
      return;
    }
    if (this.view === "exam") {
      this.root.append(this.renderFocusedExam());
      return;
    }
    this.root.append(this.renderShell());
  }

  private renderEntry(): HTMLElement {
    const main = node("main", { className: "boot view-enter", attrs: { id: "main-content", tabindex: "-1" } });
    main.append(node("p", { className: "eyebrow", text: "ESTUDIO INTERACTIVO" }));
    if (this.view === "recoveries" && this.recoveries.length) {
      main.append(
        node("h1", { text: "Elegí qué progreso recuperar", attrs: { tabindex: "-1" } }),
        node("p", { text: "Nada se abre automáticamente. Cada copia queda ligada a este navegador y ubicación del HTML." }),
      );
      const list = node("ul", { className: "recovery-list" });
      for (const recovery of this.recoveries) {
        const title = recovery.title || recovery.subject || recovery.key;
        const actions = node("div", { className: "button-row" });
        if (!recovery.corrupt) {
          actions.append(
            button("Abrir", "primary", () => this.openRecovery(recovery.key)),
            button("Exportar…", "secondary", () => this.exportRecovery(recovery.key)),
          );
        }
        actions.append(button("Eliminar…", "danger", () => this.deleteRecovery(recovery)));
        list.append(node("li", { className: "recovery-item" },
          node("h2", { text: title }),
          node("p", { text: recovery.corrupt
            ? `Copia dañada: ${recovery.error || "no se pudo validar"}`
            : `Revisión de contenido ${recovery.contentRevision ?? "—"} · estado ${recovery.stateRevision ?? "—"} · ${formatDate(recovery.updatedAt)}` }),
          actions,
        ));
      }
      main.append(list, this.importControl("Cargar otro módulo"));
    } else {
      main.append(
        node("h1", { text: "Tu estudio empieza con un módulo", attrs: { tabindex: "-1" } }),
        node("p", { text: "Cargá un archivo .study.json. Contiene las preguntas y, cuando lo exportes, también tu progreso. Todo se procesa en este dispositivo y sin internet." }),
        this.importControl("Cargar módulo"),
        node("p", { text: "Para probar la aplicación, elegí el archivo modulo-prueba.study.json incluido junto a index.html." }),
      );
    }
    if (this.notice) main.prepend(this.renderNotice());
    return main;
  }

  private renderShell(): HTMLElement {
    const shell = node("div", { className: "app-shell" });
    const nav = node("nav", { className: "side-nav", attrs: { "aria-label": "Áreas principales" } });
    nav.append(node("a", { className: "brand", attrs: { href: "#estudiar" } }, "Estudio ", node("span", { text: "Interactivo" })));
    const list = node("ul", { className: "nav-list" });
    const links: Array<["study" | "progress" | "module", string, string]> = [
      ["study", "Estudiar", "estudiar"],
      ["progress", "Progreso", "progreso"],
      ["module", "Módulo", "modulo"],
    ];
    for (const [view, label, hash] of links) {
      const active = (this.view === "results" ? "study" : this.view) === view;
      const link = node("a", {
        className: "nav-link",
        text: label,
        attrs: { href: `#${hash}`, ...(active ? { "aria-current": "page" } : {}) },
        on: { click: (event) => { event.preventDefault(); this.setView(view); } },
      });
      list.append(node("li", {}, link));
    }
    nav.append(list, node("div", { className: "save-status" },
      node("strong", { text: this.stale ? "Solo lectura" : this.volatile ? "Solo en memoria" : "Recuperación local activa" }),
      node("div", { text: this.snapshot ? `Estado ${this.snapshot.progress.stateRevision}` : "Sin módulo" }),
    ));

    const main = node("main", { className: "main", attrs: { id: "main-content" } });
    const content = node("div", { className: "content view-enter" });
    if (this.notice) content.append(this.renderNotice());
    if (this.view === "progress") content.append(this.renderProgress());
    else if (this.view === "module") content.append(this.renderModule());
    else if (this.view === "results") content.append(this.renderResults());
    else content.append(this.renderStudy());
    main.append(content);
    shell.append(nav, main, this.renderStatusRegion());
    return shell;
  }

  private renderNotice(): HTMLElement {
    const notice = this.notice!;
    return node("section", {
      className: `notice ${notice.kind}`,
      attrs: { role: notice.kind === "error" ? "alert" : "status" },
    }, node("strong", { text: notice.title }), node("p", { text: notice.detail }));
  }

  private renderStatusRegion(): HTMLElement {
    return node("div", { className: "status-region visually-hidden", attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" } },
      this.busy ? "Guardando cambios…" : this.notice?.persistent ? "" : this.notice?.title ?? "",
    );
  }

  private masthead(area: string): HTMLElement {
    const snapshot = this.snapshot!;
    return node("header", { className: "masthead" },
      node("p", { className: "eyebrow", text: area.toUpperCase() }),
      node("h1", { text: snapshot.module.title, attrs: { tabindex: "-1" } }),
      node("p", { text: `${snapshot.module.subject} · ${snapshot.questions.length} preguntas · contenido ${snapshot.module.contentRevision}` }),
    );
  }

  private renderStudy(): HTMLElement {
    const snapshot = this.snapshot!;
    const wrapper = node("div", {}, this.masthead("Estudiar"));
    if (snapshot.progress.activeRun) {
      const run = snapshot.progress.activeRun;
      const answered = runAnsweredCount(run);
      wrapper.append(node("section", { className: "section reading" },
        node("h2", { text: "Tenés un examen en curso" }),
        node("p", { text: `${answered} de ${run.items.length} respuestas registradas · ${difficultyLabel(run.filters.difficulty)} · ${run.filters.population === "nuevas" ? "Solo nuevas" : "Todas"}.` }),
        node("div", { className: "button-row" },
          button("Reanudar examen", "primary", () => this.setView("exam")),
          button("Abandonar…", "danger", () => this.abandonRun()),
        ),
      ));
      return wrapper;
    }

    const metrics = deriveMetrics(snapshot);
    const progress = node("progress", { attrs: { max: "100", value: String(metrics.coveragePercent), "aria-label": "Cobertura evaluada" } });
    wrapper.append(node("section", { className: "section reading" },
      node("h2", { text: "Tu banco, de un vistazo" }),
      node("div", { className: "coverage-ledger" },
        node("div", { className: "number", text: percent(metrics.coveragePercent) }),
        node("div", {}, node("div", { className: "label", text: "evaluado" }), node("div", { className: "fraction", text: `${metrics.evaluatedQuestions} de ${metrics.totalQuestions} preguntas` })),
        progress,
      ),
      node("p", { text: "Cobertura muestra cuánto recorriste. Precisión y dominio se calculan por separado." }),
    ));

    const difficultySelect = node("select", {
      attrs: { id: "difficulty" },
      on: { change: (event) => { this.difficulty = (event.currentTarget as HTMLSelectElement).value as DifficultyFilter; this.render(); } },
    });
    for (const value of ["mixta", ...DIFFICULTIES] as DifficultyFilter[]) {
      const option = node("option", { text: difficultyLabel(value), attrs: { value } });
      option.selected = value === this.difficulty;
      difficultySelect.append(option);
    }
    const populationSelect = node("select", {
      attrs: { id: "population" },
      on: { change: (event) => { this.population = (event.currentTarget as HTMLSelectElement).value as Population; this.render(); } },
    });
    for (const [value, label] of [["nuevas", "Solo nuevas"], ["todas", "Todas: nuevas y evaluadas"]] as Array<[Population, string]>) {
      const option = node("option", { text: label, attrs: { value } });
      option.selected = value === this.population;
      populationSelect.append(option);
    }
    const eligible = countEligible(snapshot, this.difficulty, this.population);
    const startButton = button(
      this.busy ? "Preparando y guardando…" : "Comenzar examen de 10 preguntas",
      "primary",
      () => this.startRun(eligible),
    );
    startButton.disabled = this.busy || this.stale;
    wrapper.append(node("section", { className: "section reading" },
      node("h2", { text: "Prepará un examen modelo" }),
      node("p", { text: "Vas a recibir hasta 10 preguntas únicas. Las respuestas se corrigen al entregar." }),
      node("div", { className: "exam-setup" },
        node("div", { className: "field" }, node("label", { text: "Dificultad", attrs: { for: "difficulty" } }), difficultySelect),
        node("div", { className: "field" }, node("label", { text: "Banco de preguntas", attrs: { for: "population" } }), populationSelect),
        node("div", { className: "start" },
          startButton,
          node("p", { className: "eligible", attrs: { role: "status", "aria-live": "polite" }, text: `Disponibles con estos filtros: ${eligible}` }),
        ),
      ),
    ));
    return wrapper;
  }

  private renderFocusedExam(): HTMLElement {
    const snapshot = this.snapshot;
    const run = snapshot?.progress.activeRun;
    if (!snapshot || !run) {
      this.view = "study";
      return this.renderShell();
    }
    const item = run.items[run.currentIndex]!;
    const question = findQuestion(snapshot, item.questionId);
    const main = node("main", { className: "main focused-main", attrs: { id: "main-content" } });
    const shell = node("div", { className: "question-shell view-enter" });
    if (this.notice?.persistent) shell.append(this.renderNotice());
    shell.append(
      node("div", { className: "question-topline" },
        node("span", { text: `Pregunta ${run.currentIndex + 1} de ${run.items.length}` }),
        node("span", { className: `difficulty ${question.difficulty}`, text: difficultyLabel(question.difficulty) }),
      ),
      node("h1", { className: "question-prompt", text: question.prompt, attrs: { tabindex: "-1" } }),
    );
    const fieldset = node("fieldset", { className: "answers" });
    fieldset.append(node("legend", { className: "visually-hidden", text: `Respuesta para la pregunta ${run.currentIndex + 1}` }));
    for (const optionId of item.optionOrder) {
      const option = question.options.find((candidate) => candidate.id === optionId);
      if (!option) continue;
      const input = node("input", {
        attrs: { type: "radio", name: "answer", value: option.id },
        on: { change: () => this.answer({ kind: "option", optionId: option.id }) },
      });
      input.checked = item.answer?.kind === "option" && item.answer.optionId === option.id;
      fieldset.append(node("label", { className: "answer" }, input, node("span", { text: option.text })));
    }
    const dontKnow = node("input", {
      attrs: { type: "radio", name: "answer", value: "dontKnow" },
      on: { change: () => this.answer({ kind: "dontKnow" }) },
    });
    dontKnow.checked = item.answer?.kind === "dontKnow";
    fieldset.append(node("label", { className: "answer" }, dontKnow, node("span", { text: "No sé" })));
    const submitButton = button(this.busy ? "Guardando…" : "Entregar examen", "primary", () => this.submitRun());
    submitButton.disabled = this.busy || this.stale;
    shell.append(fieldset, this.renderQuestionRail(), node("div", { className: "button-row" },
      button("Anterior", "secondary", () => this.navigate(Math.max(0, run.currentIndex - 1))),
      button("Siguiente", "secondary", () => this.navigate(Math.min(run.items.length - 1, run.currentIndex + 1))),
      button("Guardar y salir", "quiet", () => this.setView("study")),
      submitButton,
    ));
    main.append(shell, this.renderStatusRegion());
    return main;
  }

  private renderQuestionRail(): HTMLElement {
    const run = this.snapshot!.progress.activeRun!;
    const rail = node("div", { className: "question-rail", attrs: { role: "toolbar", "aria-label": "Preguntas del examen" } });
    run.items.forEach((item, index) => {
      const current = index === run.currentIndex;
      const itemButton = node("button", {
        text: String(index + 1),
        attrs: {
          type: "button",
          tabindex: current ? "0" : "-1",
          "aria-label": `Pregunta ${index + 1}, ${item.answer ? "respondida" : "sin responder"}${current ? ", actual" : ""}`,
          ...(current ? { "aria-current": "step" } : {}),
        },
        data: { answered: String(Boolean(item.answer)) },
        on: {
          click: () => this.navigate(index),
          keydown: (event) => {
            const keyboard = event as KeyboardEvent;
            let target = index;
            if (keyboard.key === "ArrowRight" || keyboard.key === "ArrowDown") target = Math.min(run.items.length - 1, index + 1);
            else if (keyboard.key === "ArrowLeft" || keyboard.key === "ArrowUp") target = Math.max(0, index - 1);
            else if (keyboard.key === "Home") target = 0;
            else if (keyboard.key === "End") target = run.items.length - 1;
            else return;
            keyboard.preventDefault();
            void this.navigate(target, true);
          },
        },
      });
      rail.append(itemButton);
    });
    return rail;
  }

  private renderProgress(): HTMLElement {
    const snapshot = this.snapshot!;
    const metrics = deriveMetrics(snapshot);
    const wrapper = node("div", {}, this.masthead("Progreso"));
    const ledger = node("div", { className: "metric-ledger" });
    const entries: Array<[string, string, string]> = [
      ["Cobertura", percent(metrics.coveragePercent), `${metrics.evaluatedQuestions} de ${metrics.totalQuestions} preguntas`],
      ["Precisión", metrics.accuracyPercent === null ? "Sin intentos" : percent(metrics.accuracyPercent), `${metrics.correctCount} correctas de ${metrics.attemptCount} intentos`],
      ["Dominio", percent(metrics.masteryPercent), `${metrics.masteredQuestions} con último resultado correcto`],
      ["Exámenes", String(snapshot.progress.priorRunSummary.runCount + snapshot.progress.runs.length), `${snapshot.progress.runs.length} con detalle disponible`],
    ];
    for (const [label, value, detail] of entries) ledger.append(node("div", { className: "metric-row" }, node("b", { text: label }), node("strong", { text: value }), node("span", { text: detail })));
    wrapper.append(node("section", { className: "section" }, node("h2", { text: "Resumen" }), ledger));

    const breakdown = node("div", { className: "metric-ledger" });
    for (const level of DIFFICULTIES) {
      const value = metrics.byDifficulty[level];
      breakdown.append(node("div", { className: "metric-row" },
        node("span", { className: `difficulty ${level}`, text: difficultyLabel(level) }),
        node("strong", { text: percent(value.coveragePercent) }),
        node("span", { text: `${value.evaluated}/${value.total} evaluadas · ${value.accuracyPercent === null ? "Sin intentos" : `${percent(value.accuracyPercent)} precisión`}` }),
      ));
    }
    wrapper.append(node("section", { className: "section" }, node("h2", { text: "Por dificultad" }), breakdown));

    const history = node("ol", { className: "history-list" });
    const runs = [...snapshot.progress.runs].reverse().slice(0, 25);
    if (!runs.length) {
      wrapper.append(node("section", { className: "section" }, node("h2", { text: "Historial" }), node("p", { text: "Tu primer resultado aparecerá acá." }), button("Ir a Estudiar", "primary", () => this.setView("study"))));
      return wrapper;
    }
    for (const run of runs) history.append(node("li", { className: "history-item" },
      node("strong", { text: `${run.correctCount}/${run.items.length} correctas` }),
      node("div", { text: `${difficultyLabel(run.filters.difficulty)} · ${formatDate(run.submittedAt)} · cobertura ${run.coverageBeforeCount} → ${run.coverageAfterCount}` }),
    ));
    wrapper.append(node("section", { className: "section" }, node("h2", { text: "Historial reciente" }), history,
      snapshot.progress.priorRunSummary.runCount ? node("p", { text: `${snapshot.progress.priorRunSummary.runCount} exámenes anteriores están resumidos para mantener el archivo liviano.` }) : null,
    ));
    return wrapper;
  }

  private renderModule(): HTMLElement {
    const snapshot = this.snapshot!;
    const wrapper = node("div", {}, this.masthead("Módulo"));
    wrapper.append(node("section", { className: "section reading" },
      node("h2", { text: "Protegé tu progreso" }),
      node("p", { text: "La recuperación del navegador ayuda en este dispositivo. El archivo exportado es la copia portable entre sesiones, ubicaciones y dispositivos." }),
      node("div", { className: "button-row" }, button("Guardar archivo…", "primary", () => this.exportSnapshot()), this.importControl("Cargar o reemplazar…")),
    ));
    if (this.volatile || this.stale) {
      wrapper.append(node("section", { className: "section reading" },
        node("h2", { text: this.stale ? "Esta pestaña está desactualizada" : "Cambios pendientes de recuperación local" }),
        node("p", { text: this.stale ? "Exportá esta copia como rescate o recargá lo guardado por la otra pestaña." : "Podés reintentar si la base guardada no cambió, exportar, o descartar los cambios en memoria." }),
        node("div", { className: "button-row" },
          this.volatile ? button("Reintentar guardado", "secondary", () => this.retryPersistence()) : null,
          button("Descartar y recargar…", "danger", () => this.discardAndReload()),
        ),
      ));
    }
    const facts = node("dl", { className: "module-facts" });
    for (const [term, value] of [
      ["ID", snapshot.module.id],
      ["Materia", snapshot.module.subject],
      ["Revisión de contenido", String(snapshot.module.contentRevision)],
      ["Revisión de estado", String(snapshot.progress.stateRevision)],
      ["Preguntas", String(snapshot.questions.length)],
      ["Actualizado", formatDate(snapshot.progress.updatedAt)],
      ["Recuperación local", this.repository.isPersistent && !this.volatile ? "Disponible" : "No confirmada"],
    ]) facts.append(node("dt", { text: term }), node("dd", { text: value }));
    wrapper.append(node("section", { className: "section reading" }, node("h2", { text: "Identidad y estado" }), facts));
    wrapper.append(node("section", { className: "section reading" },
      node("h2", { text: "Recuperaciones de este navegador" }),
      node("p", { text: "Podés volver al selector para abrir, exportar o eliminar otra copia. El módulo actual no se modifica." }),
      button("Ver recuperaciones", "secondary", async () => { this.recoveries = (await this.repository.listRecoveries()) as RecoveryLike[]; this.setView("recoveries"); }),
    ));
    return wrapper;
  }

  private renderResults(): HTMLElement {
    const snapshot = this.snapshot!;
    const run = this.resultRun ?? snapshot.progress.runs.at(-1) ?? null;
    const wrapper = node("div", {}, this.masthead("Resultados"));
    if (!run) return node("div", {}, wrapper, node("p", { text: "No hay un resultado reciente para mostrar." }));
    const coverageGain = run.coverageAfterCount - run.coverageBeforeCount;
    wrapper.append(node("section", { className: "section reading" },
      node("h2", { text: `${run.correctCount} de ${run.items.length} correctas` }),
      node("p", { text: `Cobertura ganada: ${coverageGain} ${coverageGain === 1 ? "pregunta" : "preguntas"}. Las respuestas incorrectas son una guía para la próxima práctica.` }),
      node("div", { className: "button-row" }, button("Nuevo examen", "primary", () => this.setView("study")), button("Ver Progreso", "secondary", () => this.setView("progress"))),
    ));
    const list = node("ol", { className: "result-list" });
    for (const item of run.items) {
      const question = findQuestion(snapshot, item.questionId);
      const selectedId = item.answer?.kind === "option" ? item.answer.optionId : null;
      const selected = selectedId ? question.options.find((option) => option.id === selectedId)?.text : "No sé";
      const correct = question.options.find((option) => option.id === question.correctOptionId)?.text ?? question.correctOptionId;
      const isCorrect = selectedId === question.correctOptionId;
      list.append(node("li", { className: "result-item", data: { result: isCorrect ? "correct" : "incorrect" } },
        node("h3", { text: question.prompt }),
        node("p", { className: "result-answer", text: `Tu respuesta: ${selected}` }),
        node("p", { className: "result-answer", text: `Respuesta correcta: ${correct}` }),
        node("strong", { text: isCorrect ? "Correcta" : "Incorrecta" }),
        node("p", { className: "explanation", text: question.explanation }),
        question.source ? node("p", { text: `Fuente: ${question.source.label}${question.source.reference ? ` · ${question.source.reference}` : ""}` }) : null,
      ));
    }
    wrapper.append(node("section", { className: "section" }, node("h2", { text: "Revisión pregunta por pregunta" }), list));
    return wrapper;
  }

  private importControl(label: string): HTMLElement {
    const id = `file-${++inputSerial}`;
    const input = node("input", {
      className: "file-input",
      attrs: { id, type: "file", accept: ".json,.study.json,application/json" },
      on: { change: (event) => void this.importFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null) },
    });
    return node("span", {}, input, node("label", { className: "file-button", text: label, attrs: { for: id } }));
  }

  private async openRecovery(key: string): Promise<void> {
    try {
      const snapshot = await this.store.load(key);
      if (!snapshot) throw new Error("La recuperación ya no existe.");
      this.snapshot = snapshot;
      this.volatile = this.store.getState().mode === "volatile";
      this.stale = this.store.getState().mode === "stale";
      this.notice = null;
      this.setView("study");
    } catch (error) {
      this.notice = { kind: "error", title: "No se pudo abrir esta copia", detail: String(error), persistent: true };
      this.render();
    }
  }

  private async exportRecovery(key: string): Promise<void> {
    try {
      const recovery = await this.repository.load(key);
      const result = await saveSnapshotFile(recovery);
      if (result.status === "cancelled") return;
      await this.repository.recordExportReceipt({
        recoveryKey: key,
        snapshotHash: result.snapshotHash,
        stateRevision: recovery.progress.stateRevision,
        status: result.status,
        fileName: result.fileName,
      });
      this.notice = result.status === "confirmed"
        ? { kind: "success", title: "Archivo guardado", detail: result.fileName }
        : { kind: "warning", title: "Descarga iniciada", detail: "Comprobá el archivo en Descargas." };
    } catch (error) {
      this.notice = { kind: "error", title: "No se guardó ningún archivo", detail: String(error), persistent: true };
    }
    this.render();
  }

  private async deleteRecovery(recovery: RecoveryLike): Promise<void> {
    const choice = await this.ask("Eliminar recuperación", `Se quitará “${recovery.title || recovery.key}” de este navegador. Esta acción no borra archivos exportados.`, [
      ["cancel", "Cancelar", "secondary"], ["delete", "Eliminar", "danger"],
    ]);
    if (choice !== "delete") return;
    await this.repository.remove(recovery.key);
    this.recoveries = (await this.repository.listRecoveries()) as RecoveryLike[];
    this.view = this.recoveries.length ? "recoveries" : "empty";
    this.notice = { kind: "success", title: "Recuperación eliminada", detail: "Los archivos exportados no se modificaron." };
    this.render();
  }

  private async importFile(file: File | null): Promise<void> {
    if (!file) return;
    this.notice = { kind: "success", title: "Validando…", detail: file.name };
    this.render();
    try {
      const parsed = await readSnapshotFile(file);
      const validation = validateSnapshot(parsed);
      if (!validation.ok) {
        const details = validation.errors.slice(0, 5).map((item) => `${item.path}: ${item.message}`).join("; ");
        throw new TypeError(details || "El archivo no cumple el contrato del módulo.");
      }
      const candidate = parsed as StudySnapshot;
      const candidateKey = recoveryKeyForSnapshot(candidate);
      const storeStateBeforePreview = this.store.getState();
      const ownedWriteToken = storeStateBeforePreview.recoveryKey === candidateKey
        ? storeStateBeforePreview.lastPersistedWriteToken
        : null;
      const expectedWriteToken = await this.repository.getWriteToken(candidateKey);
      let existing: StudySnapshot | null = null;
      if (expectedWriteToken !== null) {
        try {
          existing = await this.repository.load(candidateKey);
        } catch (error) {
          if (!(error instanceof RecoveryNotFoundError)) throw error;
        }
      }
      const counts = DIFFICULTIES.map((level) => `${difficultyLabel(level)} ${candidate.questions.filter((q) => q.difficulty === level).length}`).join(" · ");
      const preview = `${candidate.module.title}\n${candidate.module.subject}\n${candidate.questions.length} preguntas · ${counts}\nEstado ${candidate.progress.stateRevision}`;
      let choice = await this.ask("Vista previa del módulo", preview, [["cancel", "Cancelar", "secondary"], ["install", this.snapshot ? "Proteger y reemplazar…" : "Cargar módulo", "primary"]]);
      if (choice !== "install") return;
      if (this.snapshot) {
        const result = await this.exportSnapshot(true);
        if (!result) return;
        if (result === "attempted") {
          choice = await this.ask("Comprobá la descarga", "El navegador solo pudo iniciar la descarga. Antes de reemplazar, verificá que el archivo aparezca en Descargas.", [["cancel", "Cancelar", "secondary"], ["install", "Ya comprobé el archivo", "primary"]]);
          if (choice !== "install") return;
        }
      }
      const currentKey = this.snapshot ? recoveryKeyForSnapshot(this.snapshot) : null;
      if (
        existing &&
        requiresSeparateExistingBackup(
          currentKey,
          candidateKey,
          ownedWriteToken,
          expectedWriteToken,
        )
      ) {
        choice = await this.ask(
          "Ya existe una recuperación con esta identidad",
          `Antes de reemplazar el estado ${existing.progress.stateRevision} de “${existing.module.title}”, se exportará una copia protectora.`,
          [["cancel", "Cancelar", "secondary"], ["protect", "Exportar y reemplazar…", "primary"]],
        );
        if (choice !== "protect") return;
        const protectedResult = await saveSnapshotFile(existing);
        if (protectedResult.status === "cancelled") return;
        await this.repository.recordExportReceipt({
          recoveryKey: candidateKey,
          stateRevision: existing.progress.stateRevision,
          snapshotHash: protectedResult.snapshotHash,
          status: protectedResult.status,
          at: new Date().toISOString(),
          fileName: protectedResult.fileName,
        });
        if (protectedResult.status === "attempted") {
          choice = await this.ask(
            "Comprobá la descarga protectora",
            "El navegador solo pudo iniciar la descarga de la recuperación existente. Verificá el archivo antes de reemplazarla.",
            [["cancel", "Cancelar", "secondary"], ["install", "Ya comprobé el archivo", "primary"]],
          );
          if (choice !== "install") return;
        }
      }
      await this.install(candidate, expectedWriteToken);
    } catch (error) {
      const detail = error instanceof RecoveryReplacementRequiredError || error instanceof RecoveryWriteConflictError || error instanceof RevisionConflictError
        ? "La recuperación cambió en otra pestaña mientras confirmabas. Volvé a revisar e importar el archivo."
        : String(error);
      this.notice = { kind: "error", title: "No se pudo cargar el módulo", detail: `${detail} No se reemplazó nada.`, persistent: true };
      this.render();
      requestAnimationFrame(() => this.root.querySelector<HTMLElement>("[role=alert]")?.focus());
    }
  }

  private async startRun(eligible: number): Promise<void> {
    if (!this.snapshot || this.busy || this.stale) return;
    let acceptedSize = 10;
    if (eligible < 10) {
      const choices: Array<[string, string, string]> = [["return", "Cambiar filtros", "secondary"]];
      if (this.population === "nuevas" && countEligible(this.snapshot, this.difficulty, "todas") >= 10) choices.push(["all", "Incluir evaluadas", "primary"]);
      if (eligible > 0) choices.push(["short", `Empezar con ${eligible}`, "secondary"]);
      const choice = await this.ask(
        eligible === 0 && this.population === "nuevas" ? "Ya recorriste todas las preguntas nuevas" : "No llegan a 10 preguntas",
        eligible === 0 ? "Con estos filtros no quedan preguntas. La aplicación nunca repite ni cambia el filtro en silencio." : `Hay ${eligible} preguntas disponibles. Elegí cómo continuar.`,
        choices,
      );
      if (choice === "all") { this.population = "todas"; this.render(); return; }
      if (choice !== "short") return;
      acceptedSize = eligible;
    }
    const seed = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 1
      : (Date.now() >>> 0) || 1;
    try {
      const request = {
        difficulty: this.difficulty,
        population: this.population,
        requestedSize: 10 as const,
        acceptedSize,
        seed,
      };
      if (await this.commit((current) => createActiveRun(current, request, new Date().toISOString()))) this.setView("exam");
    } catch (error) {
      this.notice = { kind: "error", title: "No se pudo preparar el examen", detail: String(error) };
      this.render();
    }
  }

  private async answer(answer: StudyAnswer): Promise<void> {
    if (!this.snapshot || this.stale) return;
    await this.commit((current) => answerActiveRun(current, answer, new Date().toISOString()));
  }

  private async navigate(index: number, focusRail = false): Promise<void> {
    if (!this.snapshot || this.stale) return;
    if (await this.commit((current) => navigateActiveRun(current, index, new Date().toISOString()))) {
      this.view = "exam";
      this.render();
      requestAnimationFrame(() => {
        if (focusRail) this.root.querySelector<HTMLButtonElement>(`.question-rail button:nth-child(${index + 1})`)?.focus();
        else this.root.querySelector<HTMLElement>("h1")?.focus();
      });
    }
  }

  private async abandonRun(): Promise<void> {
    if (!this.snapshot) return;
    const choice = await this.ask("Abandonar examen", "Se descartan las respuestas de este examen. No cambia tu cobertura, precisión ni historial.", [["cancel", "Cancelar", "secondary"], ["abandon", "Abandonar examen", "danger"]]);
    if (choice !== "abandon") return;
    if (await this.commit((current) => abandonActiveRun(current, new Date().toISOString()))) this.setView("study");
  }

  private async submitRun(): Promise<void> {
    const run = this.snapshot?.progress.activeRun;
    if (!this.snapshot || !run || this.busy || this.stale) return;
    const unanswered = run.items.filter((item) => item.answer === null).length;
    if (unanswered) {
      const choice = await this.ask("Quedan respuestas pendientes", `${unanswered} ${unanswered === 1 ? "pregunta quedará" : "preguntas quedarán"} como “No sé” y contará como incorrecta.`, [["review", "Revisar respuestas", "secondary"], ["submit", "Entregar igual", "primary"]]);
      if (choice !== "submit") return;
    }
    const candidate = await this.commit((current) => submitActiveRun(current, new Date().toISOString()));
    if (candidate) {
      this.resultRun = candidate.progress.runs.at(-1) ?? null;
      this.setView("results");
    }
  }

  private async exportSnapshot(silent = false): Promise<"confirmed" | "attempted" | null> {
    if (!this.snapshot) return null;
    try {
      const result = await saveSnapshotFile(this.snapshot);
      const status = result.status;
      if (status === "cancelled") return null;
      await this.repository.recordExportReceipt({
        recoveryKey: recoveryKeyForSnapshot(this.snapshot),
        stateRevision: this.snapshot.progress.stateRevision,
        snapshotHash: result.snapshotHash,
        status,
        at: new Date().toISOString(),
        fileName: result.fileName,
      });
      if (!silent) {
        this.notice = status === "confirmed"
          ? { kind: "success", title: "Archivo guardado", detail: result.fileName || "La escritura terminó correctamente." }
          : { kind: "warning", title: "Descarga iniciada", detail: "Comprobá que el archivo aparezca en Descargas; el navegador no puede confirmar que lo conservaste." };
        this.render();
      }
      return status;
    } catch (error) {
      this.notice = { kind: "error", title: "No se guardó ningún archivo", detail: String(error), persistent: true };
      this.render();
      return null;
    }
  }

  private async retryPersistence(): Promise<void> {
    if (!this.snapshot || !this.volatile || !this.repository.isPersistent) return;
    try {
      this.snapshot = await this.store.retryPersistence();
      this.volatile = this.store.getState().mode === "volatile";
      this.stale = this.store.getState().mode === "stale";
      this.notice = { kind: "success", title: "Guardado local recuperado", detail: "Todos los cambios en memoria quedaron guardados localmente." };
    } catch (error) {
      if (error instanceof StaleStudyStateError) {
        this.stale = true;
        this.notice = { kind: "error", title: "La base guardada cambió", detail: "Solo podés exportar esta copia o descartarla y recargar.", persistent: true };
      } else {
        this.notice = { kind: "error", title: "El guardado sigue sin estar disponible", detail: String(error), persistent: true };
      }
    }
    this.render();
  }

  private async discardAndReload(): Promise<void> {
    if (!this.snapshot) return;
    const choice = await this.ask("Descartar cambios de esta pestaña", "Se volverá a la última copia guardada localmente. Antes podés cancelar y exportar un rescate.", [["cancel", "Cancelar", "secondary"], ["discard", "Descartar y recargar", "danger"]]);
    if (choice !== "discard") return;
    try {
      const restored = await this.store.discardAndReload();
      if (!restored) {
        this.snapshot = null;
        this.recoveries = (await this.repository.listRecoveries()) as RecoveryLike[];
        this.view = this.recoveries.length ? "recoveries" : "empty";
        this.volatile = false;
        this.stale = false;
        this.notice = { kind: "success", title: "Copia en memoria descartada", detail: "No había una recuperación local previa para recargar." };
        this.render();
        return;
      }
      this.snapshot = restored;
      this.volatile = false;
      this.stale = false;
      this.notice = { kind: "success", title: "Copia local recargada", detail: `Estado ${restored.progress.stateRevision}.` };
      this.setView(restored.progress.activeRun ? "study" : "module");
    } catch (error) {
      this.notice = { kind: "error", title: "No se pudo recargar la copia local", detail: String(error), persistent: true };
      this.render();
    }
  }

  private ask(title: string, body: string, choices: Array<[string, string, string]>): Promise<string> {
    const dialog = node("dialog");
    const heading = node("h2", { text: title, attrs: { tabindex: "-1" } });
    const form = node("form", { attrs: { method: "dialog" } });
    form.append(heading, node("p", { text: body }));
    const row = node("div", { className: "button-row" });
    for (const [value, label, className] of choices) row.append(node("button", { className, text: label, attrs: { type: "submit", value } }));
    form.append(row);
    dialog.append(form);
    document.body.append(dialog);
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => { const value = dialog.returnValue; dialog.remove(); resolve(value); }, { once: true });
      dialog.addEventListener("cancel", () => { dialog.returnValue = choices[0]?.[0] ?? "cancel"; });
      dialog.showModal();
      requestAnimationFrame(() => (row.querySelector("button") ?? heading).focus());
    });
  }
}

export async function bootApplication(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("No existe la raíz de la aplicación.");
  const application = new Application(root);
  await application.init();
}
