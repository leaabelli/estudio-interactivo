import type {
  CompletedRun,
  Difficulty,
  DifficultyFilter,
  Population,
  QuestionContentBlock,
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
import {
  buildRunTrend,
  clampPercent,
  completedRunBelongsToSnapshot,
  createRelativeNavigationAction,
  hashForRoute,
  navigationBounds,
  routeFromHash,
  scorePercent,
  type RouteView,
} from "./presentation";

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

interface ShellRefs {
  shell: HTMLElement;
  navLinks: Map<"study" | "progress" | "module", HTMLAnchorElement>;
  moduleTitle: HTMLElement;
  moduleMeta: HTMLElement;
  saveStatus: HTMLElement;
  bannerSlot: HTMLElement;
  outlet: HTMLElement;
  snackbar: HTMLElement;
  liveRegion: HTMLElement;
}

type Child = Node | string | number | null | undefined | false;
let inputSerial = 0;
let svgSerial = 0;
let dialogSerial = 0;

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

async function decodeRasterImage(dataUri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    let timeout = 0;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) {
        reject(error);
        return;
      }
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(new TypeError("la imagen no tiene dimensiones decodificadas"));
        return;
      }
      resolve();
    };
    timeout = window.setTimeout(
      () => finish(new TypeError("la decodificación excedió 10 segundos")),
      10_000,
    );
    const canDecode = typeof image.decode === "function";
    image.onload = canDecode ? null : () => finish();
    image.onerror = () => finish(new TypeError("el navegador rechazó el bitstream"));
    image.src = dataUri;
    if (canDecode) {
      void image.decode().then(
        () => finish(),
        () => finish(new TypeError("el navegador no pudo decodificar el bitstream")),
      );
    }
  });
}

async function validateRasterDecodability(snapshot: StudySnapshot): Promise<void> {
  const decodedDataUris = new Set<string>();
  for (const [questionIndex, question] of snapshot.questions.entries()) {
    for (const [blockIndex, block] of (question.supportingContent ?? []).entries()) {
      if (block.kind === "table") continue;
      const path = `$.questions[${questionIndex}].supportingContent[${blockIndex}].dataUri`;
      if (!decodedDataUris.has(block.dataUri)) {
        try {
          await decodeRasterImage(block.dataUri);
          decodedDataUris.add(block.dataUri);
        } catch {
          throw new TypeError(`${path}: el navegador no pudo decodificar el recurso raster`);
        }
      }
    }
  }
}

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    attrs?: Record<string, string>;
  } = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const namespace = document.documentElement.namespaceURI?.replace("1999/xhtml", "2000/svg")
    ?? ["http:", "", "www.w3.org", "2000", "svg"].join("/");
  const element = document.createElementNS(namespace, tag);
  if (options.className) element.setAttribute("class", options.className);
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) element.setAttribute(name, value);
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function appIcon(kind: "study" | "progress" | "module"): SVGSVGElement {
  const paths = {
    study: "M4 5.5A2.5 2.5 0 0 1 6.5 3H11v15H6.5A2.5 2.5 0 0 0 4 20.5Zm16 0A2.5 2.5 0 0 0 17.5 3H13v15h4.5a2.5 2.5 0 0 1 2.5 2.5Z",
    progress: "M4 19V9h3v10Zm6 0V4h3v15Zm6 0v-7h3v7Z",
    module: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm2 4h10V6H7Zm0 4h10v-2H7Zm0 4h7v-2H7Z",
  };
  return svgNode("svg", {
    className: "nav-icon",
    attrs: { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
  }, svgNode("path", { attrs: { d: paths[kind] } }));
}

function sourceDocumentIcon(): SVGSVGElement {
  return svgNode("svg", {
    className: "source-icon",
    attrs: { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
  },
  svgNode("path", { attrs: { d: "M6.5 2.75h7.25L19.5 8.5v12.75h-13zM13.75 2.75V8.5h5.75M9.5 13h7M9.5 16.5h5" } }),
  );
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
  private shellRefs: ShellRefs | null = null;
  private renderedView: View | null = null;
  private snackbarTimer: number | null = null;
  private shownNoticeKey = "";
  private readonly routeScrollPositions = new Map<RouteView, number>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async init(): Promise<void> {
    try {
      this.repository = await StudyRepository.open();
      this.store = await createStudyStore(this.repository);
      this.store.subscribe((state) => {
        const hadActiveRun = Boolean(this.snapshot?.progress.activeRun);
        this.snapshot = state.snapshot;
        const activeRunChanged = hadActiveRun !== Boolean(state.snapshot?.progress.activeRun);
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
        if (this.root.childNodes.length) {
          const refreshRoute = this.view === "progress"
            || this.view === "module"
            || this.view === "results"
            || this.view === "recoveries"
            || (this.view === "study" && activeRunChanged);
          this.render(refreshRoute);
        }
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
    history.scrollRestoration = "manual";
    window.addEventListener("popstate", () => this.restoreRouteFromHistory());
    this.render();
  }

  private setView(
    view: View,
    focus = true,
    historyMode: "push" | "replace" | "none" = "push",
  ): void {
    const previousView = this.view;
    const routeChanged = previousView !== view;
    if (routeChanged && this.isRouteView(previousView)) {
      this.routeScrollPositions.set(previousView, window.scrollY);
    }
    this.view = view;
    if (this.isRouteView(view) && historyMode !== "none") {
      const targetHash = hashForRoute(view);
      if (historyMode === "replace") history.replaceState({ view }, "", targetHash);
      else if (location.hash !== targetHash) history.pushState({ view }, "", targetHash);
    }
    this.render();
    if (routeChanged || focus) {
      requestAnimationFrame(() => {
        if (routeChanged) window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        if (focus) this.shellRefs?.outlet.querySelector<HTMLElement>(".route-title")?.focus({ preventScroll: true });
      });
    }
  }

  private isRouteView(view: View): view is RouteView {
    return view === "study" || view === "exam" || view === "results" || view === "progress" || view === "module";
  }

  private normalizeRoute(view: RouteView): RouteView {
    if (view === "exam" && !this.snapshot?.progress.activeRun) return "study";
    const hasRememberedResult = Boolean(
      this.snapshot && this.resultRun && completedRunBelongsToSnapshot(this.snapshot, this.resultRun),
    );
    if (view === "results" && !hasRememberedResult && !this.snapshot?.progress.runs.length) return "study";
    return view;
  }

  private restoreRouteFromHistory(): void {
    if (!this.snapshot) return;
    const previousView = this.view;
    const route = routeFromHash(location.hash) ?? "study";
    const normalized = this.normalizeRoute(route);
    if (previousView !== normalized && this.isRouteView(previousView)) {
      this.routeScrollPositions.set(previousView, window.scrollY);
    }
    this.view = normalized;
    if (normalized !== route) history.replaceState({ view: normalized }, "", hashForRoute(normalized));
    this.render();
    requestAnimationFrame(() => {
      window.scrollTo({ top: this.routeScrollPositions.get(normalized) ?? 0, left: 0, behavior: "auto" });
      this.shellRefs?.outlet.querySelector<HTMLElement>(".route-title")?.focus({ preventScroll: true });
    });
  }

  private async install(snapshot: StudySnapshot, expectedWriteToken: number | null): Promise<void> {
    await this.store.install(snapshot, expectedWriteToken);
    this.snapshot = this.store.getState().snapshot;
    this.resultRun = null;
    this.routeScrollPositions.clear();
    this.volatile = this.store.getState().mode === "volatile";
    this.stale = this.store.getState().mode === "stale";
    this.notice = {
      kind: "success",
      title: "Módulo listo",
      detail: `${snapshot.questions.length} preguntas cargadas. El progreso del archivo se conservó exactamente.`,
    };
    this.setView("study", true, "replace");
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

  private render(forceRoute = false): void {
    const wantsAppShell = Boolean(
      this.snapshot && this.view !== "empty" && (this.view !== "recoveries" || this.snapshot),
    );
    if (!wantsAppShell) {
      this.shellRefs = null;
      this.renderedView = null;
      this.root.replaceChildren(this.renderEntry());
      return;
    }

    if (!this.shellRefs || !this.shellRefs.shell.isConnected) {
      this.mountAppShell();
      forceRoute = true;
    }
    this.syncAppChrome();
    if (forceRoute || this.renderedView !== this.view) {
      this.shellRefs!.outlet.replaceChildren(this.renderRoute());
      this.renderedView = this.view;
    } else {
      this.syncCurrentRoute();
    }
  }

  private renderEntry(): HTMLElement {
    const main = node("main", { className: "boot route-panel", attrs: { id: "main-content", tabindex: "-1" } });
    main.append(node("div", { className: "entry-brand" },
      node("span", { className: "brand-mark", text: "E", attrs: { "aria-hidden": "true" } }),
      node("span", { text: "Estudio Interactivo" }),
    ));
    if (this.view === "recoveries" && this.recoveries.length) {
      main.append(
        node("p", { className: "eyebrow", text: "RECUPERACIÓN LOCAL" }),
        node("h1", { className: "route-title", text: "Elegí tu progreso", attrs: { tabindex: "-1" } }),
        node("p", { className: "page-intro", text: "Cada copia pertenece a este navegador y a esta ubicación del HTML." }),
        this.renderRecoveryList(),
        this.importControl("Cargar otro módulo"),
      );
    } else {
      main.append(
        node("div", { className: "entry-copy" },
          node("p", { className: "eyebrow", text: "TU ESPACIO DE PRÁCTICA" }),
          node("h1", { className: "route-title", text: "Estudiá a tu ritmo", attrs: { tabindex: "-1" } }),
          node("p", { className: "page-intro", text: "Cargá un módulo, practicá en etapas y llevate el progreso dentro del mismo archivo." }),
        ),
        node("section", { className: "import-card", attrs: { "aria-label": "Cargar módulo de estudio" } },
          node("div", { className: "import-illustration", attrs: { "aria-hidden": "true" } }, ".study"),
          node("h2", { text: "Abrí un módulo" }),
          node("p", { text: "Todo se procesa en este dispositivo. No hace falta internet." }),
          this.importControl("Elegir archivo"),
          node("p", { className: "supporting", text: "Podés empezar con modulo-prueba.study.json." }),
        ),
      );
    }
    if (this.notice) main.prepend(this.renderNotice());
    return main;
  }

  private mountAppShell(): void {
    const snapshot = this.snapshot!;
    const shell = node("div", { className: "app-shell" });
    const nav = node("nav", { className: "side-nav", attrs: { "aria-label": "Áreas principales" } });
    const brand = node("a", {
      className: "brand",
      attrs: { href: "#estudiar", "aria-label": "Ir a Estudiar" },
      on: { click: (event) => { event.preventDefault(); this.setView("study"); } },
    }, node("span", { className: "brand-mark", text: "E" }), node("span", { className: "brand-name", text: "Estudio" }));
    const list = node("ul", { className: "nav-list" });
    const navLinks = new Map<"study" | "progress" | "module", HTMLAnchorElement>();
    const links: Array<["study" | "progress" | "module", string]> = [
      ["study", "Estudiar"],
      ["progress", "Progreso"],
      ["module", "Módulo"],
    ];
    for (const [view, label] of links) {
      const link = node("a", {
        className: "nav-link",
        attrs: { href: hashForRoute(view) },
        on: { click: (event) => { event.preventDefault(); this.setView(view); } },
      }, appIcon(view), node("span", { text: label }));
      navLinks.set(view, link);
      list.append(node("li", {}, link));
    }
    nav.append(brand, list);

    const moduleTitle = node("strong", { className: "app-module-title", text: snapshot.module.title });
    const moduleMeta = node("span", { className: "app-module-meta", text: snapshot.module.subject });
    const saveStatus = node("div", { className: "save-status", attrs: { role: "status", "aria-live": "polite" } });
    const appBar = node("header", { className: "app-bar" },
      node("div", { className: "app-bar-module" }, moduleTitle, moduleMeta),
      saveStatus,
    );
    const bannerSlot = node("div", { className: "banner-slot" });
    const outlet = node("div", { className: "route-outlet" });
    const main = node("main", { className: "main", attrs: { id: "main-content" } }, outlet);
    const snackbar = node("div", { className: "snackbar", attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const liveRegion = node("div", { className: "visually-hidden", attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const frame = node("div", { className: "app-frame" }, appBar, bannerSlot, main);
    shell.append(nav, frame, snackbar, liveRegion);
    this.root.replaceChildren(shell);
    if (this.snackbarTimer !== null) window.clearTimeout(this.snackbarTimer);
    this.snackbarTimer = null;
    this.shownNoticeKey = "";
    this.shellRefs = { shell, navLinks, moduleTitle, moduleMeta, saveStatus, bannerSlot, outlet, snackbar, liveRegion };
    this.renderedView = null;
  }

  private renderNotice(): HTMLElement {
    const notice = this.notice!;
    return node("section", {
      className: `notice ${notice.kind}`,
      attrs: {
        role: notice.kind === "error" ? "alert" : "status",
        ...(notice.kind === "error" ? { tabindex: "-1" } : {}),
      },
    },
    node("span", { className: "notice-icon", text: notice.kind === "success" ? "✓" : "!", attrs: { "aria-hidden": "true" } }),
    node("div", {}, node("strong", { text: notice.title }), node("p", { text: notice.detail })),
    );
  }

  private syncAppChrome(): void {
    const refs = this.shellRefs;
    const snapshot = this.snapshot;
    if (!refs || !snapshot) return;
    refs.moduleTitle.textContent = snapshot.module.title;
    refs.moduleMeta.textContent = `${snapshot.module.subject} · ${snapshot.questions.length} preguntas`;

    const activeView = this.view === "results" || this.view === "exam" ? "study" : this.view;
    for (const [view, link] of refs.navLinks) {
      if (activeView === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }

    const state = this.busy ? "busy" : this.stale ? "stale" : this.volatile ? "volatile" : "saved";
    const label = this.busy ? "Guardando…" : this.stale ? "Solo lectura" : this.volatile ? "Solo en memoria" : "Guardado local";
    refs.saveStatus.className = `save-status ${state}`;
    refs.saveStatus.replaceChildren(
      node("span", { className: "status-dot", attrs: { "aria-hidden": "true" } }),
      node("span", {}, node("strong", { text: label }), node("small", { text: `Estado ${snapshot.progress.stateRevision}` })),
    );
    refs.liveRegion.textContent = this.busy ? "Guardando cambios" : "";
    this.syncNotice();
  }

  private syncNotice(): void {
    const refs = this.shellRefs;
    if (!refs) return;
    const notice = this.notice;
    const key = notice ? `${notice.kind}|${notice.persistent ? "1" : "0"}|${notice.title}|${notice.detail}` : "";
    if (key === this.shownNoticeKey) return;
    this.shownNoticeKey = key;
    if (this.snackbarTimer !== null) window.clearTimeout(this.snackbarTimer);
    this.snackbarTimer = null;
    refs.bannerSlot.replaceChildren();
    refs.snackbar.replaceChildren();
    refs.snackbar.removeAttribute("data-visible");
    if (!notice) return;
    if (notice.persistent) {
      refs.bannerSlot.append(this.renderNotice());
      return;
    }
    refs.snackbar.className = `snackbar ${notice.kind}`;
    refs.snackbar.append(node("strong", { text: notice.title }), node("span", { text: notice.detail }));
    refs.snackbar.dataset.visible = "true";
    this.snackbarTimer = window.setTimeout(() => {
      if (this.shownNoticeKey !== key) return;
      refs.snackbar.removeAttribute("data-visible");
      this.notice = null;
      this.shownNoticeKey = "";
    }, 4800);
  }

  private renderRoute(): HTMLElement {
    if (this.view === "progress") return this.renderProgress();
    if (this.view === "module") return this.renderModule();
    if (this.view === "results") return this.renderResults();
    if (this.view === "exam") return this.renderFocusedExam();
    if (this.view === "recoveries") return this.renderRecoveriesRoute();
    return this.renderStudy();
  }

  private syncCurrentRoute(): void {
    if (this.view === "exam") this.syncExamRoute();
    else if (this.view === "study") this.syncStudyRoute();
  }

  private pageHeader(title: string, description: string, eyebrow?: string): HTMLElement {
    return node("header", { className: "page-header" },
      eyebrow ? node("p", { className: "eyebrow", text: eyebrow }) : null,
      node("h1", { className: "route-title", text: title, attrs: { tabindex: "-1" } }),
      node("p", { className: "page-intro", text: description }),
    );
  }

  private renderRecoveryList(): HTMLElement {
    const list = node("ul", { className: "recovery-list" });
    for (const recovery of this.recoveries) {
      const title = recovery.title || recovery.subject || recovery.key;
      const actions = node("div", { className: "button-row compact" });
      if (!recovery.corrupt) {
        actions.append(
          button("Abrir", "primary", () => this.openRecovery(recovery.key)),
          button("Exportar…", "secondary", () => this.exportRecovery(recovery.key)),
        );
      }
      actions.append(button("Eliminar…", "danger", () => this.deleteRecovery(recovery)));
      list.append(node("li", { className: "recovery-item" },
        node("div", { className: "recovery-copy" },
          node("h2", { text: title }),
          node("p", { text: recovery.corrupt
            ? `Copia dañada: ${recovery.error || "no se pudo validar"}`
            : `Contenido ${recovery.contentRevision ?? "—"} · estado ${recovery.stateRevision ?? "—"} · ${formatDate(recovery.updatedAt)}` }),
        ),
        actions,
      ));
    }
    return list;
  }

  private renderRecoveriesRoute(): HTMLElement {
    return node("div", { className: "route-panel" },
      this.pageHeader("Recuperaciones", "Abrí, exportá o eliminá una copia guardada en este navegador."),
      this.renderRecoveryList(),
      this.importControl("Cargar otro módulo"),
    );
  }

  private renderStudy(): HTMLElement {
    const snapshot = this.snapshot!;
    const wrapper = node("div", { className: "route-panel study-route" },
      this.pageHeader("Estudiar", "Elegí cómo practicar. El banco no repite preguntas nuevas en silencio.", "PRÁCTICA"),
    );
    if (snapshot.progress.activeRun) {
      const run = snapshot.progress.activeRun;
      const answered = runAnsweredCount(run);
      wrapper.append(node("section", { className: "resume-panel" },
        this.renderPercentRing((answered / run.items.length) * 100, "respondido", `${answered}/${run.items.length}`, "compact"),
        node("div", { className: "resume-copy" },
          node("p", { className: "eyebrow", text: "EXAMEN EN CURSO" }),
          node("h2", { text: "Seguí donde lo dejaste" }),
          node("p", { text: `${answered} de ${run.items.length} respuestas · ${difficultyLabel(run.filters.difficulty)} · ${run.filters.population === "nuevas" ? "Solo nuevas" : "Todas"}.` }),
        ),
        node("div", { className: "button-row" },
          button("Reanudar examen", "primary", () => this.setView("exam")),
          button("Abandonar…", "danger", () => this.abandonRun()),
        ),
      ));
      return wrapper;
    }

    const metrics = deriveMetrics(snapshot);
    wrapper.append(node("section", { className: "overview-grid", attrs: { "aria-label": "Resumen de progreso" } },
      node("article", { className: "coverage-card" },
        this.renderPercentRing(metrics.coveragePercent, "evaluado", `${metrics.evaluatedQuestions}/${metrics.totalQuestions}`),
        node("div", { className: "coverage-copy" },
          node("p", { className: "eyebrow", text: "COBERTURA TOTAL" }),
          node("h2", { text: metrics.evaluatedQuestions ? "Tu banco ya está en movimiento" : "Todo listo para empezar" }),
          node("p", { text: `${metrics.evaluatedQuestions} de ${metrics.totalQuestions} preguntas evaluadas al menos una vez.` }),
          button("Ver progreso", "text-button", () => this.setView("progress")),
        ),
      ),
      node("div", { className: "metric-card-grid" },
        this.renderMetricCard(
          "Precisión",
          metrics.accuracyPercent === null ? "—" : percent(metrics.accuracyPercent),
          metrics.accuracyPercent === null ? "Todavía no hay intentos" : `${metrics.correctCount} de ${metrics.attemptCount} intentos correctos`,
          "primary",
        ),
        this.renderMetricCard(
          "Último resultado correcto",
          percent(metrics.masteryPercent),
          `${metrics.masteredQuestions} preguntas con último intento correcto`,
          "success",
        ),
      ),
    ));

    const difficultySelect = node("select", {
      attrs: { id: "difficulty" },
      on: { change: (event) => { this.difficulty = (event.currentTarget as HTMLSelectElement).value as DifficultyFilter; this.syncStudyRoute(); } },
    });
    for (const value of ["mixta", ...DIFFICULTIES] as DifficultyFilter[]) {
      const option = node("option", { text: difficultyLabel(value), attrs: { value } });
      option.selected = value === this.difficulty;
      difficultySelect.append(option);
    }
    const populationSelect = node("select", {
      attrs: { id: "population" },
      on: { change: (event) => { this.population = (event.currentTarget as HTMLSelectElement).value as Population; this.syncStudyRoute(); } },
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
      () => this.startRun(countEligible(this.snapshot!, this.difficulty, this.population)),
    );
    startButton.dataset.action = "start-exam";
    startButton.disabled = this.busy || this.stale;
    wrapper.append(node("section", { className: "setup-panel" },
      node("div", { className: "section-heading" },
        node("div", {}, node("p", { className: "eyebrow", text: "NUEVO RUN" }), node("h2", { text: "Prepará un examen modelo" })),
        node("span", { className: "question-count-chip", text: "10 preguntas" }),
      ),
      node("div", { className: "exam-setup" },
        node("div", { className: "field" }, node("label", { text: "Dificultad", attrs: { for: "difficulty" } }), difficultySelect),
        node("div", { className: "field" }, node("label", { text: "Banco de preguntas", attrs: { for: "population" } }), populationSelect),
        node("div", { className: "start" },
          startButton,
          node("p", { className: "eligible", data: { role: "eligible" }, attrs: { role: "status", "aria-live": "polite" }, text: `${eligible} disponibles con estos filtros` }),
        ),
      ),
    ));
    return wrapper;
  }

  private syncStudyRoute(): void {
    const outlet = this.shellRefs?.outlet;
    const snapshot = this.snapshot;
    if (!outlet || !snapshot || snapshot.progress.activeRun) return;
    const difficultySelect = outlet.querySelector<HTMLSelectElement>("#difficulty");
    if (difficultySelect) difficultySelect.value = this.difficulty;
    const populationSelect = outlet.querySelector<HTMLSelectElement>("#population");
    if (populationSelect) populationSelect.value = this.population;
    const eligible = countEligible(snapshot, this.difficulty, this.population);
    const copy = outlet.querySelector<HTMLElement>("[data-role=eligible]");
    if (copy) copy.textContent = `${eligible} disponibles con estos filtros`;
    const startButton = outlet.querySelector<HTMLButtonElement>("[data-action=start-exam]");
    if (startButton) {
      startButton.disabled = this.busy || this.stale;
      startButton.textContent = this.busy ? "Preparando y guardando…" : "Comenzar examen de 10 preguntas";
    }
  }

  private renderMetricCard(label: string, value: string, detail: string, tone: "primary" | "success" | "neutral" = "neutral"): HTMLElement {
    return node("article", { className: `metric-card ${tone}` },
      node("span", { className: "metric-label", text: label }),
      node("strong", { className: "metric-value", text: value }),
      node("span", { className: "metric-detail", text: detail }),
    );
  }

  private renderPercentRing(value: number, label: string, detail: string, modifier = ""): HTMLElement {
    const safeValue = clampPercent(value);
    const titleId = `ring-title-${++svgSerial}`;
    const chart = svgNode("svg", {
      className: "ring-chart",
      attrs: { viewBox: "0 0 120 120", role: "img", "aria-labelledby": titleId },
    },
    svgNode("title", { attrs: { id: titleId }, text: `${label}: ${percent(safeValue)}` }),
    svgNode("circle", { className: "ring-track", attrs: { cx: "60", cy: "60", r: "48", pathLength: "100" } }),
    svgNode("circle", {
      className: "ring-value",
      attrs: {
        cx: "60", cy: "60", r: "48", pathLength: "100",
        "stroke-dasharray": `${safeValue} ${100 - safeValue}`,
      },
    }),
    );
    return node("div", { className: `percent-ring ${modifier}`.trim() }, chart,
      node("div", { className: "ring-label" },
        node("strong", { text: percent(safeValue) }),
        node("span", { text: label }),
        node("small", { text: detail }),
      ),
    );
  }

  private renderFocusedExam(): HTMLElement {
    const snapshot = this.snapshot;
    const run = snapshot?.progress.activeRun;
    if (!snapshot || !run) {
      this.view = "study";
      return this.renderStudy();
    }
    const answered = runAnsweredCount(run);
    const route = node("div", { className: "route-panel exam-route" },
      node("header", { className: "exam-header" },
        node("div", {},
          node("p", { className: "eyebrow", text: "EXAMEN EN CURSO" }),
          node("strong", { className: "exam-position", data: { role: "exam-position" }, text: `Pregunta ${run.currentIndex + 1} de ${run.items.length}` }),
        ),
        node("span", { className: "answered-chip", data: { role: "answered-count" }, text: `${answered}/${run.items.length} respondidas` }),
      ),
      node("progress", { className: "exam-progress", data: { role: "exam-progress" }, attrs: { max: String(run.items.length), value: String(answered), "aria-label": "Preguntas respondidas" } }),
    );
    const stage = node("section", { className: "question-stage", data: { questionId: run.items[run.currentIndex]!.questionId } }, this.renderQuestionStage());
    const readPosition = () => {
      const activeRun = this.snapshot?.progress.activeRun;
      return activeRun
        ? { currentIndex: activeRun.currentIndex, itemCount: activeRun.items.length }
        : null;
    };
    const previousButton = button("Anterior", "secondary", createRelativeNavigationAction(
      readPosition,
      (index) => this.navigate(index),
      -1,
    ));
    previousButton.dataset.action = "previous-question";
    const nextButton = button("Siguiente", "secondary", createRelativeNavigationAction(
      readPosition,
      (index) => this.navigate(index),
      1,
    ));
    nextButton.dataset.action = "next-question";
    const submitButton = button(this.busy ? "Guardando…" : "Entregar examen", "primary", () => this.submitRun());
    submitButton.dataset.action = "submit-exam";
    const bounds = navigationBounds(run.currentIndex, run.items.length);
    previousButton.disabled = bounds.previousDisabled || this.busy || this.stale;
    nextButton.disabled = bounds.nextDisabled || this.busy || this.stale;
    submitButton.disabled = this.busy || this.stale;
    route.append(stage, this.renderQuestionRail(), node("footer", { className: "exam-actions" },
      node("div", { className: "button-row exam-navigation" }, previousButton, nextButton),
      node("div", { className: "button-row exam-submit" },
        button("Guardar y salir", "text-button", () => this.setView("study")),
        submitButton,
      ),
    ));
    return route;
  }

  private renderQuestionStage(): HTMLElement {
    const snapshot = this.snapshot!;
    const run = snapshot.progress.activeRun!;
    const item = run.items[run.currentIndex]!;
    const question = findQuestion(snapshot, item.questionId);
    const shell = node("div", { className: "question-card" },
      node("div", { className: "question-topline" },
        node("span", { className: `difficulty ${question.difficulty}`, text: difficultyLabel(question.difficulty) }),
        node("span", { className: "topic-chip", text: question.topic }),
      ),
      node("h1", { className: "question-prompt route-title", text: question.prompt, attrs: { tabindex: "-1" } }),
    );
    if (question.body) {
      shell.append(node("p", { className: "question-body", text: question.body }));
    }
    const supportingContent = this.renderQuestionSupportingContent(question);
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
      input.disabled = this.stale;
      fieldset.append(node("label", { className: "answer" }, input, node("span", { text: option.text })));
    }
    const dontKnow = node("input", {
      attrs: { type: "radio", name: "answer", value: "dontKnow" },
      on: { change: () => this.answer({ kind: "dontKnow" }) },
    });
    dontKnow.checked = item.answer?.kind === "dontKnow";
    dontKnow.disabled = this.stale;
    fieldset.append(node("label", { className: "answer" }, dontKnow, node("span", { text: "No sé" })));
    if (supportingContent) shell.append(supportingContent);
    shell.append(fieldset);
    return shell;
  }

  private renderQuestionSource(question: StudyQuestion, review = false): HTMLElement | null {
    if (!question.source) return null;
    return node("div", {
      className: `question-source${review ? " question-source--review" : ""}`,
      attrs: { role: "note", "aria-label": "Fuente de la pregunta" },
      data: { role: "question-source" },
    },
    node("span", { className: "source-icon-wrap" }, sourceDocumentIcon()),
    node("div", { className: "source-copy" },
      node("span", { className: "source-kicker", text: "Fuente" }),
      node("strong", { className: "source-label", text: question.source.label }),
      question.source.reference
        ? node("span", { className: "source-reference", text: question.source.reference })
        : null,
    ));
  }

  private renderQuestionSupportingContent(question: StudyQuestion, review = false): HTMLElement | null {
    if (!question.supportingContent?.length) return null;
    const wrapper = node("div", {
      className: `question-content${review ? " question-content--review" : ""}`,
      data: { role: "question-content" },
    });
    for (const block of question.supportingContent) {
      wrapper.append(this.renderQuestionContentBlock(block, review));
    }
    return wrapper;
  }

  private renderQuestionContentBlock(block: QuestionContentBlock, review: boolean): HTMLElement {
    if (block.kind === "table") {
      const table = node("table", { className: "question-table" });
      table.append(node("caption", { text: block.caption }));
      const headerRow = node("tr");
      for (const column of block.columns) {
        headerRow.append(node("th", { text: column, attrs: { scope: "col" } }));
      }
      table.append(node("thead", {}, headerRow));
      const body = node("tbody");
      for (const row of block.rows) {
        const tableRow = node("tr");
        row.forEach((cell, columnIndex) => {
          tableRow.append(block.rowHeaderColumn === columnIndex
            ? node("th", { text: cell, attrs: { scope: "row" } })
            : node("td", { text: cell }));
        });
        body.append(tableRow);
      }
      table.append(body);
      return node("div", {
        className: "question-content-block question-table-scroll",
        attrs: { role: "region", "aria-label": block.caption, tabindex: "0" },
        data: { contentKind: "table" },
      }, table);
    }

    const image = node("img", {
      attrs: {
        alt: block.alt,
        width: String(block.width),
        height: String(block.height),
        decoding: "async",
        loading: review ? "lazy" : "eager",
      },
    });
    const fallback = node("div", {
      className: "question-media-fallback",
      attrs: { hidden: "", role: "status" },
    },
    node("strong", { text: "No se pudo mostrar este recurso visual" }),
    node("p", { text: block.alt }));
    image.addEventListener("error", () => {
      image.remove();
      fallback.hidden = false;
    });
    image.src = block.dataUri;
    return node("figure", {
      className: "question-content-block question-media",
      data: { contentKind: block.kind },
    },
    image,
    fallback,
    block.caption
      ? node("figcaption", {},
        node("span", { className: "visual-kind", text: block.kind === "diagram" ? "Diagrama" : "Imagen" }),
        node("span", { text: block.caption }),
      )
      : null);
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

  private syncExamRoute(): void {
    const outlet = this.shellRefs?.outlet;
    const snapshot = this.snapshot;
    const run = snapshot?.progress.activeRun;
    if (!outlet || !snapshot || !run) return;
    const item = run.items[run.currentIndex]!;
    const stage = outlet.querySelector<HTMLElement>(".question-stage");
    if (stage && stage.dataset.questionId !== item.questionId) {
      stage.dataset.questionId = item.questionId;
      stage.replaceChildren(this.renderQuestionStage());
    }
    const answered = runAnsweredCount(run);
    const position = outlet.querySelector<HTMLElement>("[data-role=exam-position]");
    const answeredCopy = outlet.querySelector<HTMLElement>("[data-role=answered-count]");
    const progress = outlet.querySelector<HTMLProgressElement>("[data-role=exam-progress]");
    if (position) position.textContent = `Pregunta ${run.currentIndex + 1} de ${run.items.length}`;
    if (answeredCopy) answeredCopy.textContent = `${answered}/${run.items.length} respondidas`;
    if (progress) progress.value = answered;
    const railButtons = outlet.querySelectorAll<HTMLButtonElement>(".question-rail button");
    run.items.forEach((runItem, index) => {
      const railButton = railButtons.item(index);
      if (!railButton) return;
      const current = index === run.currentIndex;
      railButton.dataset.answered = String(Boolean(runItem.answer));
      railButton.tabIndex = current ? 0 : -1;
      railButton.setAttribute("aria-label", `Pregunta ${index + 1}, ${runItem.answer ? "respondida" : "sin responder"}${current ? ", actual" : ""}`);
      if (current) railButton.setAttribute("aria-current", "step");
      else railButton.removeAttribute("aria-current");
      railButton.disabled = this.busy || this.stale;
    });
    const bounds = navigationBounds(run.currentIndex, run.items.length);
    const previous = outlet.querySelector<HTMLButtonElement>("[data-action=previous-question]");
    const next = outlet.querySelector<HTMLButtonElement>("[data-action=next-question]");
    const submit = outlet.querySelector<HTMLButtonElement>("[data-action=submit-exam]");
    if (previous) previous.disabled = bounds.previousDisabled || this.busy || this.stale;
    if (next) next.disabled = bounds.nextDisabled || this.busy || this.stale;
    if (submit) {
      submit.disabled = this.busy || this.stale;
      submit.textContent = this.busy ? "Guardando…" : "Entregar examen";
    }
    const currentInputs = stage?.querySelectorAll<HTMLInputElement>("input[name=answer]") ?? [];
    for (const input of currentInputs) {
      input.disabled = this.stale;
      if (!this.busy) {
        input.checked = item.answer?.kind === "dontKnow"
          ? input.value === "dontKnow"
          : item.answer?.kind === "option" && input.value === item.answer.optionId;
      }
    }
  }

  private renderProgress(): HTMLElement {
    const snapshot = this.snapshot!;
    const metrics = deriveMetrics(snapshot);
    const runCount = snapshot.progress.priorRunSummary.runCount + snapshot.progress.runs.length;
    const wrapper = node("div", { className: "route-panel progress-route" },
      this.pageHeader("Progreso", "Cobertura, precisión y evolución se muestran por separado para que cada señal sea clara.", "ANÁLISIS"),
      node("section", { className: "progress-summary", attrs: { "aria-label": "Resumen general" } },
        node("article", { className: "coverage-card compact-card" },
          this.renderPercentRing(metrics.coveragePercent, "evaluado", `${metrics.evaluatedQuestions}/${metrics.totalQuestions}`),
          node("div", { className: "coverage-copy" }, node("h2", { text: "Cobertura" }), node("p", { text: `${metrics.evaluatedQuestions} preguntas vistas de ${metrics.totalQuestions}.` })),
        ),
        this.renderMetricCard("Precisión", metrics.accuracyPercent === null ? "—" : percent(metrics.accuracyPercent), metrics.accuracyPercent === null ? "Sin intentos todavía" : `${metrics.correctCount} correctas de ${metrics.attemptCount}`, "primary"),
        this.renderMetricCard("Último resultado correcto", percent(metrics.masteryPercent), `${metrics.masteredQuestions} de ${metrics.totalQuestions} preguntas`, "success"),
        this.renderMetricCard("Exámenes", String(runCount), `${snapshot.progress.runs.length} con detalle disponible`, "neutral"),
      ),
      node("section", { className: "chart-card" },
        node("div", { className: "section-heading" }, node("div", {}, node("p", { className: "eyebrow", text: "COBERTURA" }), node("h2", { text: "Por dificultad" }))),
        this.renderDifficultyBars(),
      ),
      this.renderRunTrendChart(),
    );

    const history = node("ol", { className: "history-list" });
    const runs = [...snapshot.progress.runs].reverse().slice(0, 25);
    if (!runs.length) {
      wrapper.append(node("section", { className: "empty-state" }, node("h2", { text: "Tu historial empieza con el primer examen" }), node("p", { text: "Cuando entregues un run, vas a ver su resultado y el avance de cobertura." }), button("Ir a Estudiar", "primary", () => this.setView("study"))));
      return wrapper;
    }
    for (const run of runs) history.append(node("li", { className: "history-item" },
      node("span", { className: "history-score", text: `${run.correctCount}/${run.items.length}` }),
      node("div", { className: "history-copy" },
        node("strong", { text: `${percent(scorePercent(run.correctCount, run.items.length))} de precisión` }),
        node("span", { text: `${difficultyLabel(run.filters.difficulty)} · ${formatDate(run.submittedAt)}` }),
      ),
      node("span", { className: "coverage-gain", text: `+${run.coverageAfterCount - run.coverageBeforeCount} nuevas` }),
    ));
    wrapper.append(node("section", { className: "history-section" },
      node("div", { className: "section-heading" }, node("div", {}, node("p", { className: "eyebrow", text: "ACTIVIDAD" }), node("h2", { text: "Historial reciente" }))),
      history,
      snapshot.progress.priorRunSummary.runCount ? node("p", { text: `${snapshot.progress.priorRunSummary.runCount} exámenes anteriores están resumidos para mantener el archivo liviano.` }) : null,
    ));
    return wrapper;
  }

  private renderDifficultyBars(): HTMLElement {
    const metrics = deriveMetrics(this.snapshot!);
    const list = node("div", { className: "difficulty-bars" });
    for (const level of DIFFICULTIES) {
      const value = metrics.byDifficulty[level];
      list.append(node("div", { className: `difficulty-bar ${level}` },
        node("div", { className: "difficulty-bar-label" },
          node("span", { className: `difficulty ${level}`, text: difficultyLabel(level) }),
          node("strong", { text: percent(value.coveragePercent) }),
        ),
        node("progress", { attrs: { max: "100", value: String(value.coveragePercent), "aria-label": `Cobertura ${difficultyLabel(level)}` } }),
        node("div", { className: "difficulty-bar-detail" },
          node("span", { text: `${value.evaluated}/${value.total} evaluadas` }),
          node("span", { text: value.accuracyPercent === null ? "Sin intentos" : `${percent(value.accuracyPercent)} precisión` }),
        ),
      ));
    }
    return list;
  }

  private renderRunTrendChart(): HTMLElement {
    const trend = buildRunTrend(this.snapshot!);
    const section = node("section", { className: "chart-card run-trend" },
      node("div", { className: "section-heading" },
        node("div", {}, node("p", { className: "eyebrow", text: "EVOLUCIÓN" }), node("h2", { text: "Últimos exámenes" })),
        node("div", { className: "chart-legend", attrs: { "aria-label": "Leyenda" } },
          node("span", { className: "legend-accuracy", text: "Precisión" }),
          node("span", { className: "legend-coverage", text: "Cobertura" }),
        ),
      ),
    );
    if (!trend.length) {
      section.append(node("div", { className: "empty-chart" }, node("strong", { text: "Sin runs todavía" }), node("span", { text: "La tendencia aparece después del primer examen." })));
      return section;
    }

    const left = 46;
    const right = 616;
    const top = 20;
    const bottom = 188;
    const height = bottom - top;
    const xFor = (index: number): number => trend.length === 1 ? (left + right) / 2 : left + (index / (trend.length - 1)) * (right - left);
    const yFor = (value: number): number => bottom - (clampPercent(value) / 100) * height;
    const svg = svgNode("svg", { className: "run-chart", attrs: { viewBox: "0 0 640 225", "aria-hidden": "true", focusable: "false" } });
    for (const tick of [0, 50, 100]) {
      const y = yFor(tick);
      svg.append(
        svgNode("line", { className: "chart-grid-line", attrs: { x1: String(left), y1: String(y), x2: String(right), y2: String(y) } }),
        svgNode("text", { className: "chart-axis-label", attrs: { x: "8", y: String(y + 4) }, text: `${tick}%` }),
      );
    }
    trend.forEach((point, index) => {
      const x = xFor(index);
      const y = yFor(point.accuracyPercent);
      svg.append(
        svgNode("rect", { className: "accuracy-bar", attrs: { x: String(x - 9), y: String(y), width: "18", height: String(bottom - y), rx: "5" } }),
        svgNode("text", { className: "chart-run-label", attrs: { x: String(x), y: "213", "text-anchor": "middle" }, text: String(point.runNumber) }),
      );
    });
    const coveragePoints = trend.map((point, index) => `${xFor(index)},${yFor(point.coveragePercent)}`).join(" ");
    svg.append(svgNode("polyline", { className: "coverage-line", attrs: { points: coveragePoints } }));
    trend.forEach((point, index) => svg.append(svgNode("circle", { className: "coverage-point", attrs: { cx: String(xFor(index)), cy: String(yFor(point.coveragePercent)), r: "4" } })));

    const accessible = node("ol", { className: "visually-hidden" });
    for (const point of trend) accessible.append(node("li", { text: `Examen ${point.runNumber}: ${percent(point.accuracyPercent)} de precisión y ${percent(point.coveragePercent)} de cobertura.` }));
    section.append(svg, accessible, node("p", { className: "chart-caption", text: "Las barras muestran precisión. La línea muestra cuánto del banco ya habías evaluado al terminar cada examen." }));
    return section;
  }

  private renderModule(): HTMLElement {
    const snapshot = this.snapshot!;
    const wrapper = node("div", { className: "route-panel module-route" },
      this.pageHeader("Módulo", "Guardá una copia portable o revisá cómo está identificado este banco.", "ARCHIVO"),
    );
    wrapper.append(node("section", { className: "surface-panel primary-panel" },
      node("h2", { text: "Protegé tu progreso" }),
      node("p", { text: "La recuperación del navegador ayuda en este dispositivo. El archivo exportado es la copia portable entre sesiones, ubicaciones y dispositivos." }),
      node("div", { className: "button-row" }, button("Guardar archivo…", "primary", () => this.exportSnapshot()), this.importControl("Cargar o reemplazar…")),
    ));
    if (this.volatile || this.stale) {
      wrapper.append(node("section", { className: "surface-panel warning-panel" },
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
    wrapper.append(node("section", { className: "surface-panel" }, node("h2", { text: "Identidad y estado" }), facts));
    wrapper.append(node("section", { className: "surface-panel" },
      node("h2", { text: "Recuperaciones de este navegador" }),
      node("p", { text: "Podés volver al selector para abrir, exportar o eliminar otra copia. El módulo actual no se modifica." }),
      button("Ver recuperaciones", "secondary", async () => { this.recoveries = (await this.repository.listRecoveries()) as RecoveryLike[]; this.setView("recoveries"); }),
    ));
    return wrapper;
  }

  private renderResults(): HTMLElement {
    const snapshot = this.snapshot!;
    const rememberedRun = this.resultRun && completedRunBelongsToSnapshot(snapshot, this.resultRun)
      ? this.resultRun
      : null;
    if (!rememberedRun) this.resultRun = null;
    const run = rememberedRun ?? snapshot.progress.runs.at(-1) ?? null;
    const wrapper = node("div", { className: "route-panel results-route" },
      this.pageHeader("Resultados", "Revisá qué salió bien y qué conviene practicar otra vez.", "RUN COMPLETADO"),
    );
    if (!run) return node("div", {}, wrapper, node("p", { text: "No hay un resultado reciente para mostrar." }));
    const coverageGain = run.coverageAfterCount - run.coverageBeforeCount;
    wrapper.append(node("section", { className: "result-hero" },
      this.renderPercentRing(scorePercent(run.correctCount, run.items.length), "precisión", `${run.correctCount}/${run.items.length}`, "score-ring"),
      node("div", { className: "result-copy" },
        node("p", { className: "eyebrow", text: "RESULTADO" }),
        node("h2", { text: `${run.correctCount} de ${run.items.length} correctas` }),
        node("p", { text: coverageGain
          ? `Sumaste ${coverageGain} ${coverageGain === 1 ? "pregunta nueva" : "preguntas nuevas"} a tu cobertura.`
          : "Este run reforzó preguntas que ya habías evaluado." }),
        node("div", { className: "result-stats" },
          node("span", { className: "success-chip", text: `${run.correctCount} correctas` }),
          node("span", { className: "error-chip", text: `${run.incorrectCount} incorrectas` }),
          node("span", { className: "coverage-chip", text: `+${coverageGain} cobertura` }),
        ),
        node("div", { className: "button-row" }, button("Nuevo examen", "primary", () => this.setView("study")), button("Ver progreso", "secondary", () => this.setView("progress"))),
      ),
    ));
    const list = node("ol", { className: "result-list" });
    for (const item of run.items) {
      const question = findQuestion(snapshot, item.questionId);
      const selectedId = item.answer?.kind === "option" ? item.answer.optionId : null;
      const selected = selectedId ? question.options.find((option) => option.id === selectedId)?.text : "No sé";
      const correct = question.options.find((option) => option.id === question.correctOptionId)?.text ?? question.correctOptionId;
      const isCorrect = selectedId === question.correctOptionId;
      list.append(node("li", { className: "result-item", data: { result: isCorrect ? "correct" : "incorrect" } },
        node("div", { className: "result-item-heading" },
          node("span", { className: "result-marker", text: isCorrect ? "✓" : "×", attrs: { "aria-hidden": "true" } }),
          node("div", { className: "result-question-copy" },
            node("h3", { text: question.prompt }),
            question.body ? node("p", { className: "result-question-body", text: question.body }) : null,
          ),
        ),
        this.renderQuestionSupportingContent(question, true),
        node("p", { className: "result-answer", text: `Tu respuesta: ${selected}` }),
        node("p", { className: "result-answer", text: `Respuesta correcta: ${correct}` }),
        node("strong", { className: "result-verdict", text: isCorrect ? "Correcta" : "Incorrecta" }),
        node("p", { className: "explanation", text: question.explanation }),
        this.renderQuestionSource(question, true),
      ));
    }
    wrapper.append(node("section", { className: "review-section" },
      node("div", { className: "section-heading" }, node("div", {}, node("p", { className: "eyebrow", text: "REVISIÓN" }), node("h2", { text: "Pregunta por pregunta" }))),
      list,
    ));
    return wrapper;
  }

  private importControl(label: string): HTMLElement {
    const id = `file-${++inputSerial}`;
    const input = node("input", {
      className: "file-input",
      attrs: { id, type: "file", accept: ".json,.study.json,application/json" },
      on: { change: (event) => {
        const current = event.currentTarget as HTMLInputElement;
        const file = current.files?.[0] ?? null;
        current.value = "";
        void this.importFile(file);
      } },
    });
    return node("span", {}, input, node("label", { className: "file-button", text: label, attrs: { for: id } }));
  }

  private async openRecovery(key: string): Promise<void> {
    try {
      const snapshot = await this.store.load(key);
      if (!snapshot) throw new Error("La recuperación ya no existe.");
      this.snapshot = snapshot;
      this.resultRun = null;
      this.routeScrollPositions.clear();
      this.volatile = this.store.getState().mode === "volatile";
      this.stale = this.store.getState().mode === "stale";
      this.notice = null;
      this.setView("study", true, "replace");
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
    this.render(true);
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
    this.render(true);
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
      await validateRasterDecodability(candidate);
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
      this.notice = null;
      this.render();
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
      if (choice === "all") { this.population = "todas"; this.syncStudyRoute(); return; }
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
    const run = this.snapshot?.progress.activeRun;
    if (!this.snapshot || !run || this.stale || index < 0 || index >= run.items.length) return;
    if (await this.commit((current) => navigateActiveRun(current, index, new Date().toISOString()))) {
      this.view = "exam";
      this.render();
      requestAnimationFrame(() => {
        if (focusRail) this.root.querySelector<HTMLButtonElement>(`.question-rail button:nth-child(${index + 1})`)?.focus();
        else {
          const stage = this.shellRefs?.outlet.querySelector<HTMLElement>(".question-stage");
          stage?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
          stage?.querySelector<HTMLElement>(".question-prompt")?.focus({ preventScroll: true });
        }
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
    this.render(true);
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
      this.routeScrollPositions.clear();
      this.volatile = false;
      this.stale = false;
      this.notice = { kind: "success", title: "Copia local recargada", detail: `Estado ${restored.progress.stateRevision}.` };
      this.setView(restored.progress.activeRun ? "study" : "module", true, "replace");
    } catch (error) {
      this.notice = { kind: "error", title: "No se pudo recargar la copia local", detail: String(error), persistent: true };
      this.render();
    }
  }

  private ask(title: string, body: string, choices: Array<[string, string, string]>): Promise<string> {
    const serial = ++dialogSerial;
    const headingId = `dialog-title-${serial}`;
    const descriptionId = `dialog-description-${serial}`;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = node("dialog", { attrs: { "aria-labelledby": headingId, "aria-describedby": descriptionId } });
    const heading = node("h2", { text: title, attrs: { id: headingId, tabindex: "-1" } });
    const form = node("form", { attrs: { method: "dialog" } });
    form.append(heading, node("p", { text: body, attrs: { id: descriptionId } }));
    const row = node("div", { className: "button-row" });
    for (const [value, label, className] of choices) row.append(node("button", { className, text: label, attrs: { type: "submit", value } }));
    form.append(row);
    dialog.append(form);
    document.body.append(dialog);
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => {
        const value = dialog.returnValue;
        dialog.remove();
        const focusTarget = previouslyFocused?.isConnected && previouslyFocused !== document.body
          ? previouslyFocused
          : this.root.querySelector<HTMLElement>(".file-input, .route-title");
        focusTarget?.focus({ preventScroll: true });
        resolve(value);
      }, { once: true });
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
