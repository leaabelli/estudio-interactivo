export const DIFFICULTIES = ["facil", "medio", "dificil", "experto"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type DifficultyFilter = Difficulty | "mixta";
export type Population = "nuevas" | "todas";

export interface StudyOption {
  id: string;
  text: string;
}

export interface QuestionSource {
  label: string;
  reference?: string;
}

export interface QuestionTableBlock {
  kind: "table";
  caption: string;
  columns: string[];
  rows: string[][];
  rowHeaderColumn?: number;
}

export interface QuestionMediaBlock {
  kind: "image" | "diagram";
  dataUri: string;
  alt: string;
  caption?: string;
  width: number;
  height: number;
}

export type QuestionContentBlock = QuestionTableBlock | QuestionMediaBlock;

export interface StudyQuestion {
  id: string;
  revision: number;
  difficulty: Difficulty;
  topic: string;
  prompt: string;
  options: StudyOption[];
  correctOptionId: string;
  explanation: string;
  source?: QuestionSource;
  supportingContent?: QuestionContentBlock[];
}

export interface ModuleMetadata {
  id: string;
  contentRevision: number;
  title: string;
  subject: string;
  description: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export type StudyAnswer =
  | { kind: "option"; optionId: string }
  | { kind: "dontKnow" };

export interface QuestionProgress {
  questionRevision: number;
  attempts: number;
  correct: number;
  lastResult: "correct" | "incorrect" | null;
  lastAnswer: StudyAnswer | null;
  lastSubmittedAt: string | null;
  lastCompletedStateRevision: number | null;
}

export interface RunFilters {
  difficulty: DifficultyFilter;
  population: Population;
  requestedSize: 10;
  acceptedSize: number;
}

export interface RunItem {
  questionId: string;
  questionRevision: number;
  optionOrder: string[];
  answer: StudyAnswer | null;
}

export interface RunBase {
  id: string;
  createdStateRevision: number;
  completedStateRevision: number | null;
  startedAt: string;
  seed: number;
  filters: RunFilters;
  coverageBeforeCount: number;
  items: RunItem[];
}

export interface ActiveRun extends RunBase {
  status: "active";
  submittedAt: null;
  currentIndex: number;
}

export interface CompletedRun extends RunBase {
  status: "completed";
  completedStateRevision: number;
  submittedAt: string;
  correctCount: number;
  incorrectCount: number;
  coverageAfterCount: number;
}

export interface DifficultySummary {
  attempts: number;
  correct: number;
}

export interface PriorRunSummary {
  runCount: number;
  attemptCount: number;
  correctCount: number;
  firstSubmittedAt: string | null;
  lastSubmittedAt: string | null;
  byDifficulty: Record<Difficulty, DifficultySummary>;
}

export interface StudyProgress {
  updatedAt: string;
  stateRevision: number;
  questions: Record<string, QuestionProgress>;
  runs: CompletedRun[];
  priorRunSummary: PriorRunSummary;
  activeRun: ActiveRun | null;
}

export interface StudySnapshot {
  schemaVersion: 1;
  module: ModuleMetadata;
  questions: StudyQuestion[];
  progress: StudyProgress;
}

export interface SelectionRequest {
  difficulty: DifficultyFilter;
  population: Population;
  requestedSize: 10;
  acceptedSize?: number;
  seed: number;
}

export interface StudyMetrics {
  totalQuestions: number;
  evaluatedQuestions: number;
  coveragePercent: number;
  attemptCount: number;
  correctCount: number;
  accuracyPercent: number | null;
  masteredQuestions: number;
  masteryPercent: number;
  byDifficulty: Record<
    Difficulty,
    {
      total: number;
      evaluated: number;
      coveragePercent: number;
      attempts: number;
      correct: number;
      accuracyPercent: number | null;
      mastered: number;
      masteryPercent: number;
    }
  >;
}

export function emptyPriorRunSummary(): PriorRunSummary {
  return {
    runCount: 0,
    attemptCount: 0,
    correctCount: 0,
    firstSubmittedAt: null,
    lastSubmittedAt: null,
    byDifficulty: {
      facil: { attempts: 0, correct: 0 },
      medio: { attempts: 0, correct: 0 },
      dificil: { attempts: 0, correct: 0 },
      experto: { attempts: 0, correct: 0 }
    }
  };
}
