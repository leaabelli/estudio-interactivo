// Run after `bun run build`: NODE_PATH=<directory containing playwright> node tests/browser/configurable-exams.mjs
// Uses an isolated browser context and synthetic questions; never changes user recoveries.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = new URL("../../", import.meta.url);
const artifacts = fileURLToPath(new URL("output/playwright/configurable-exams/", root));
await mkdir(artifacts, { recursive: true });
const html = await readFile(new URL("index.html", root));
const fixture = JSON.parse(await readFile(new URL("modulo-prueba.study.json", root), "utf8"));
fixture.module.id = "qa.configurable-exams";
fixture.module.title = "Prueba de exámenes configurables";
fixture.questions.forEach((question, index) => { question.topic = ["Cálculo", "Conceptuales", "Casos"][index % 3]; });
const server = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, acceptDownloads: true, reducedMotion: "reduce" });
// Exercise the portable-download path without an OS file picker.
await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
const status = page.locator("#exam-configuration-status");
const start = page.getByRole("button", { name: /^Comenzar examen/ });
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Condition did not become true");
};
const exportSnapshot = async (name) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar archivo…", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(`${artifacts}/${name}.study.json`);
  return JSON.parse(await readFile(`${artifacts}/${name}.study.json`, "utf8"));
};
const importSnapshot = async (target, snapshot) => {
  await target.locator('input[type="file"]').first().setInputFiles({
    name: "prueba.study.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(snapshot))
  });
  await target.getByRole("button", { name: "Cargar módulo", exact: true }).click();
  await target.getByRole("heading", { name: "Estudiar", exact: true }).waitFor();
};
const noOverflow = async () => {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal viewport overflow");
};

const openEditor = async () => {
  if (!await page.locator("#exam-editor").isVisible()) await page.getByRole("button", { name: "Editar reparto", exact: true }).click();
};
const countOf = async (topic) => Number(await page.getByLabel(`Cantidad de ${topic}`, { exact: true }).innerText());
const adjust = async (topic, target) => {
  await openEditor();
  let count = await countOf(topic);
  while (count !== target) {
    await page.getByRole("button", { name: `${count < target ? 'Agregar' : 'Quitar'} una pregunta de ${topic}`, exact: true }).click();
    count += count < target ? 1 : -1;
    assert.equal(await countOf(topic), count);
  }
};
const chooseTotal = async (total) => {
  await openEditor();
  if ([10, 20, 30].includes(total)) {
    await page.getByRole("group", { name: "Cantidad de preguntas", exact: true }).getByRole("button", { name: String(total), exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Otra cantidad", exact: true }).click();
    await page.getByLabel("Otra cantidad de preguntas", { exact: true }).fill(String(total));
  }
};

try {
  await page.goto(address);
  await importSnapshot(page, fixture);
  assert.equal(await page.locator("#exam-distribution").count(), 0);
  assert.equal(await page.locator('input[type="number"]:visible').count(), 0);
  assert.match(await page.locator("#exam-total").innerText(), /10 preguntas/);
  await chooseTotal(20);
  await page.getByRole("button", { name: "Conceptuales", exact: true }).click();
  assert.equal(await countOf("Conceptuales"), 0);
  assert.equal(await countOf("Cálculo"), 10);
  assert.equal(await countOf("Casos"), 10);
  assert.equal(await page.getByRole("button", { name: "Agregar una pregunta de Conceptuales", exact: true }).isDisabled(), true);
  await start.click();
  await page.getByRole("button", { name: "Pausar examen", exact: true }).click();
  const automatic = await exportSnapshot("automatic-subset");
  assert.deepEqual(automatic.progress.activeRun.filters.topicQuotas, [{ topic: "Casos", count: 10 }, { topic: "Cálculo", count: 10 }]);
  await page.getByRole("button", { name: "Abandonar…", exact: true }).click();
  await page.getByRole("button", { name: "Abandonar examen", exact: true }).click();
  await openEditor();
  await page.getByRole("button", { name: "Conceptuales", exact: true }).click();
  await adjust("Cálculo", 5);
  await adjust("Conceptuales", 5);
  await adjust("Casos", 10);
  assert.match(await page.locator("#exam-total").innerText(), /20 preguntas/);
  assert.equal(await start.isEnabled(), true);

  // Keyboard and pointer steppers only affect their own topic and the total.
  await page.getByRole("button", { name: "Agregar una pregunta de Casos", exact: true }).press("Space");
  assert.equal(await countOf("Casos"), 11);
  assert.equal(await countOf("Cálculo"), 5);
  assert.equal(await countOf("Conceptuales"), 5);
  assert.match(await page.locator("#exam-total").innerText(), /21 preguntas/);
  await adjust("Casos", 16);
  assert.equal(await page.getByRole("button", { name: "Agregar una pregunta de Casos", exact: true }).isDisabled(), true);
  await adjust("Casos", 10);
  await adjust("Conceptuales", 0);
  assert.equal(await page.getByRole("button", { name: "Quitar una pregunta de Conceptuales", exact: true }).isDisabled(), true);
  await adjust("Conceptuales", 5);
  await page.getByRole("button", { name: "Guardar reparto", exact: true }).click();
  assert.match(await page.locator("#saved-exam-summary").innerText(), /20 preguntas · 3 temas/);

  // Old saved filters are ignored; old manual topics missing from selectedTopics remain editable.
  const presetKey = `estudio-interactivo.exam-setup.v1.${encodeURIComponent(fixture.module.id)}`;
  await page.evaluate((key) => {
    const preset = JSON.parse(localStorage.getItem(key));
    if ("population" in preset || "difficulty" in preset) throw new Error("Practice filters leaked into the saved distribution");
    localStorage.setItem(key, JSON.stringify({ ...preset, selectedTopics: ["Cálculo", "Casos"], population: "falladas", difficulty: "experto" }));
  }, presetKey);
  await page.reload();
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  assert.equal(await page.locator("#exam-editor").isVisible(), false);
  assert.equal(await page.getByLabel("Dificultad", { exact: true }).inputValue(), "mixta");
  assert.equal(await page.getByRole("radio", { name: /^Nuevas/ }).isChecked(), true);
  await openEditor();
  assert.equal(await page.getByRole("button", { name: "Conceptuales", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByLabel("Dificultad", { exact: true }).selectOption("experto");
  for (const label of ["Falladas", "Práctica inteligente", "Nuevas"]) {
    await page.getByRole("radiogroup", { name: "¿Qué querés practicar?" }).getByText(label, { exact: true }).click();
    await openEditor();
    await page.getByRole("button", { name: "Quitar una pregunta de Casos", exact: true }).click();
    await page.getByRole("button", { name: "Usar reparto", exact: true }).click();
    assert.equal(await page.getByRole("radio", { name: new RegExp(`^${label}`) }).isChecked(), true);
    assert.equal(await page.getByLabel("Dificultad", { exact: true }).inputValue(), "experto");
    assert.equal(await countOf("Casos"), 10);
    assert.equal(await start.isDisabled(), true);
  }
  await page.getByLabel("Dificultad", { exact: true }).selectOption("mixta");
  await openEditor();
  await page.getByRole("button", { name: "Repartir parejo", exact: true }).click();
  const balanced = await Promise.all(["Cálculo", "Conceptuales", "Casos"].map(countOf));
  assert.equal(balanced.reduce((sum, n) => sum + n, 0), 20);
  assert.ok(Math.max(...balanced) - Math.min(...balanced) <= 1);
  await page.getByRole("button", { name: "Usar reparto", exact: true }).click();
  await openEditor();
  await page.locator('.snackbar[data-visible="true"]').waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1280, height: 1300 });
  const sizeButtons = await page.locator("[data-size]").evaluateAll((buttons) => buttons.map((button) => ({ top: button.getBoundingClientRect().top, width: button.getBoundingClientRect().width })));
  assert.equal(new Set(sizeButtons.map(({ top }) => top)).size, 1, "preset totals stay on one row");
  assert.ok(sizeButtons.every(({ width }) => width < 150), "preset totals stay compact");
  await page.locator(".setup-panel").screenshot({ path: `${artifacts}/desktop-setup.png` });
  await noOverflow();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "¿Cuántas preguntas?", exact: true }).evaluate((element) => {
    element.scrollIntoView({ block: "start" }); window.scrollBy(0, -130);
  });
  await page.screenshot({ path: `${artifacts}/mobile-setup.png` });
  await page.locator("#exam-topics").evaluate((element) => {
    element.scrollIntoView({ block: "start" }); window.scrollBy(0, -130);
  });
  await page.screenshot({ path: `${artifacts}/mobile-topics.png` });
  await noOverflow();
  await start.click();
  await waitFor(async () => await page.locator(".question-rail button").count() === 20);
  assert.equal(await page.locator(".question-rail button").count(), 20);
  await page.locator(".question-rail button").nth(19).click();
  await page.getByRole("radio", { name: "No sé", exact: true }).check();
  await waitFor(async () => await page.locator(".exam-submit button").last().isEnabled());
  await page.getByRole("button", { name: "Pausar examen", exact: true }).click();
  const paused = await exportSnapshot("paused");
  const run = paused.progress.activeRun;
  assert.equal(run.currentIndex, 19);
  assert.deepEqual(run.items[19].answer, { kind: "dontKnow" });
  const counts = {};
  for (const item of run.items) {
    const topic = paused.questions.find((q) => q.id === item.questionId).topic;
    counts[topic] = (counts[topic] ?? 0) + 1;
  }
  assert.deepEqual(counts, { "Cálculo": 5, "Conceptuales": 5, "Casos": 10 });
  assert.equal(new Set(run.items.map((item) => item.questionId)).size, 20);
  await page.reload();
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  await page.getByRole("button", { name: "Reanudar examen", exact: true }).click();
  assert.equal(await page.getByRole("radio", { name: "No sé", exact: true }).isChecked(), true);
  assert.equal(await page.locator(".question-rail button").count(), 20);
  await page.screenshot({ path: `${artifacts}/mobile-resumed.png`, fullPage: true });
  await noOverflow();
  await page.getByRole("button", { name: "Entregar examen", exact: true }).click();
  await page.getByRole("button", { name: "Entregar igual", exact: true }).click();
  await page.locator(".result-list").waitFor();
  const completed = await exportSnapshot("completed");
  assert.equal(completed.progress.activeRun, null);
  assert.equal(completed.progress.runs[0].incorrectCount, 20);
  assert.deepEqual(completed.progress.runs[0].filters.topicQuotas, run.filters.topicQuotas);
  const restoredContext = await browser.newContext({ reducedMotion: "reduce" });
  try {
    const restored = await restoredContext.newPage();
    await restored.goto(address);
    await importSnapshot(restored, paused);
    await restored.getByRole("button", { name: "Reanudar examen", exact: true }).click();
    assert.equal(await restored.locator(".question-rail button").count(), 20);
    assert.equal(await restored.getByRole("radio", { name: "No sé", exact: true }).isChecked(), true);
  } finally { await restoredContext.close(); }

  await page.getByRole("link", { name: "Estudiar", exact: true }).click();
  await chooseTotal(50);
  await page.getByRole("button", { name: "Todos los temas", exact: true }).click();
  await page.getByRole("radiogroup", { name: "¿Qué querés practicar?" }).getByText("Práctica inteligente", { exact: true }).click();
  await start.click();
  await page.getByRole("heading", { name: "No llegan a 50 preguntas" }).waitFor();
  await page.getByRole("button", { name: "Empezar con 48", exact: true }).click();
  await waitFor(async () => await page.locator(".question-rail button").count() === 48);
  await page.getByRole("button", { name: "Pausar examen", exact: true }).click();
  const shorter = await exportSnapshot("shorter");
  assert.equal(shorter.progress.activeRun.filters.requestedSize, 50);
  assert.equal(shorter.progress.activeRun.filters.acceptedSize, 48);
  assert.equal(shorter.progress.activeRun.filters.topicQuotas, undefined);
  await page.getByRole("button", { name: "Abandonar…", exact: true }).click();
  await page.getByRole("button", { name: "Abandonar examen", exact: true }).click();
  await chooseTotal(0);
  assert.equal(await start.isDisabled(), true);
  await page.getByRole("button", { name: "Repasar 10 falladas", exact: true }).click();
  await waitFor(async () => await page.locator(".question-rail button").count() === 10);

  const financial = JSON.parse(await readFile(new URL("modulos/informacion-financiera/informacion-financiera-ampliado.study.json", root), "utf8"));
  await page.getByRole("button", { name: "Pausar examen", exact: true }).click();
  await page.getByRole("link", { name: "Módulo", exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "financiera.study.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(financial))
  });
  const protectedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Proteger y reemplazar…", exact: true }).click();
  await (await protectedDownload).saveAs(`${artifacts}/protected-synthetic.study.json`);
  await page.getByRole("button", { name: "Ya comprobé el archivo", exact: true }).click();
  await page.getByRole("heading", { name: "Estudiar", exact: true }).waitFor();
  assert.match(await page.locator("#exam-total").innerText(), /10 preguntas/);
  const topics = [...new Set(financial.questions.map((q) => q.topic))];
  const renderedTopics = await page.locator("[data-topic-toggle]").evaluateAll((buttons) => buttons.map((b) => b.dataset.topicToggle));
  assert.deepEqual(renderedTopics.sort(), topics.sort());
  assert.equal(await page.getByRole("button", { name: "Cálculo", exact: true }).count(), 0);
  await chooseTotal(1);
  await page.getByRole("button", { name: "Ningún tema", exact: true }).click();
  assert.equal(await start.isDisabled(), true);
  await page.getByRole("button", { name: "IVA", exact: true }).click();
  assert.equal(await start.isEnabled(), true);
  await noOverflow();
  await start.click();
  await waitFor(async () => await page.locator(".question-rail button").count() === 1);
  assert.equal(await page.locator(".topic-chip").innerText(), "IVA");
  await page.reload();
  await page.locator(".recovery-item").filter({ hasText: fixture.module.title }).getByRole("button", { name: "Abrir", exact: true }).click();
  await page.getByRole("button", { name: "Abandonar…", exact: true }).click();
  await page.getByRole("button", { name: "Abandonar examen", exact: true }).click();
  assert.match(await page.locator("#exam-total").innerText(), /50 preguntas/);
  assert.equal(await page.locator('[data-topic-toggle][aria-pressed="true"]').count(), 3);

  const blockedContext = await browser.newContext();
  try {
    await blockedContext.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
    });
    const blocked = await blockedContext.newPage();
    await blocked.goto(address);
    await importSnapshot(blocked, fixture);
    await blocked.getByRole("button", { name: "Guardar reparto", exact: true }).click();
    assert.match(await blocked.locator("#exam-setup-note").innerText(), /No se pudo guardar/);
    assert.equal(await blocked.getByRole("button", { name: /^Comenzar examen/ }).isEnabled(), true);
  } finally { await blockedContext.close(); }
  assert.deepEqual(errors, []);
  console.log("PASS: button totals, dynamic topic toggles, bounded independent +/- steps, equal redistribution, last distribution/edit, legacy presets without practice filters, keyboard, mobile/desktop, exact 5/5/10, export/import/reload, shortages, coach, module isolation, blocked storage.");
  console.log(`Artifacts: ${artifacts}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
