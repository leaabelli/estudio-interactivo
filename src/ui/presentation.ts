import type { CompletedRun, StudySnapshot } from "../domain/types";

export type RouteView = "study" | "exam" | "results" | "progress" | "module";

const ROUTE_HASHES: Record<RouteView, string> = {
  study: "#estudiar",
  exam: "#examen",
  results: "#resultados",
  progress: "#progreso",
  module: "#modulo",
};

export interface RunTrendPoint {
  runNumber: number;
  submittedAt: string;
  accuracyPercent: number;
  coveragePercent: number;
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function hashForRoute(view: RouteView): string {
  return ROUTE_HASHES[view];
}

export function routeFromHash(hash: string): RouteView | null {
  const normalized = hash.trim().toLowerCase();
  for (const [view, routeHash] of Object.entries(ROUTE_HASHES) as Array<[RouteView, string]>) {
    if (routeHash === normalized) return view;
  }
  return null;
}

export function navigationBounds(index: number, length: number): {
  previousDisabled: boolean;
  nextDisabled: boolean;
} {
  return {
    previousDisabled: length <= 0 || index <= 0,
    nextDisabled: length <= 0 || index >= length - 1,
  };
}

export function scorePercent(correctCount: number, itemCount: number): number {
  return clampPercent(percentage(correctCount, itemCount));
}

export function runAccuracyPercent(run: Pick<CompletedRun, "correctCount" | "items">): number {
  return scorePercent(run.correctCount, run.items.length);
}

export function completedRunBelongsToSnapshot(snapshot: StudySnapshot, run: CompletedRun): boolean {
  const recordedRun = snapshot.progress.runs.find((candidate) => candidate.id === run.id);
  if (!recordedRun || recordedRun.completedStateRevision !== run.completedStateRevision) return false;
  const questionIds = new Set(snapshot.questions.map((question) => question.id));
  return run.items.every((item) => questionIds.has(item.questionId));
}

export function buildRunTrend(snapshot: StudySnapshot, maximumPoints = 12): RunTrendPoint[] {
  if (maximumPoints <= 0 || snapshot.progress.runs.length === 0) return [];
  const visibleRuns = snapshot.progress.runs.slice(-maximumPoints);
  const firstRunNumber =
    snapshot.progress.priorRunSummary.runCount +
    snapshot.progress.runs.length -
    visibleRuns.length +
    1;

  return visibleRuns.map((run, index) => ({
    runNumber: firstRunNumber + index,
    submittedAt: run.submittedAt,
    accuracyPercent: runAccuracyPercent(run),
    coveragePercent: clampPercent(
      percentage(run.coverageAfterCount, snapshot.questions.length),
    ),
  }));
}
