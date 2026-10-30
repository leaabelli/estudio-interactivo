import { MAX_RUN_SIZE, type TopicQuota } from "./types";

export interface ExamSetup {
  version: 1;
  mode: "auto" | "custom";
  total: number;
  selectedTopics: string[];
  topicQuotas: TopicQuota[];
}

/** Even distribution, capped by availability. A shortage is returned, never hidden. */
export function distributeTopics(total: number, available: ReadonlyMap<string, number>, topics: ReadonlySet<string>): TopicQuota[] {
  if (!Number.isInteger(total) || total < 1 || total > MAX_RUN_SIZE) return [];
  const quotas = [...available].filter(([topic, count]) => topics.has(topic) && count > 0)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([topic]) => ({ topic, count: 0 }));
  let remaining = total;
  while (remaining > 0) {
    let allocated = 0;
    for (const quota of quotas) {
      if (remaining === 0) break;
      if (quota.count < available.get(quota.topic)!) {
        quota.count++;
        remaining--;
        allocated++;
      }
    }
    if (!allocated) break;
  }
  return quotas.filter(({ count }) => count > 0);
}

/** A step changes only this topic. Null means the button must not change anything. */
export function stepTopicQuota(quotas: readonly TopicQuota[], topic: string, delta: -1 | 1, available: ReadonlyMap<string, number>): TopicQuota[] | null {
  const count = quotas.find((quota) => quota.topic === topic)?.count ?? 0;
  const next = count + delta;
  const total = quotas.reduce((sum, quota) => sum + quota.count, 0) + delta;
  if ((delta !== -1 && delta !== 1) || !available.has(topic) || next < 0 || (delta > 0 && next > available.get(topic)!) || total > MAX_RUN_SIZE) return null;
  return [...quotas.filter((quota) => quota.topic !== topic).map((quota) => ({ ...quota })), { topic, count: next }]
    .filter((quota) => quota.count > 0);
}

/** Local preferences are untrusted. Legacy difficulty/population fields are ignored. */
export function parseExamSetup(value: unknown): ExamSetup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const setup = value as ExamSetup;
  const topic = (value: unknown): value is string => typeof value === "string" && [...value].length > 0 && [...value].length <= 120;
  if (setup.version !== 1 || !["auto", "custom"].includes(setup.mode)
    || !Number.isInteger(setup.total) || setup.total < 1 || setup.total > MAX_RUN_SIZE
    || !Array.isArray(setup.selectedTopics) || setup.selectedTopics.length > MAX_RUN_SIZE || !setup.selectedTopics.every(topic)
    || !Array.isArray(setup.topicQuotas) || setup.topicQuotas.length > MAX_RUN_SIZE
    || !setup.topicQuotas.every((quota) => quota && topic(quota.topic) && Number.isInteger(quota.count) && quota.count > 0 && quota.count <= MAX_RUN_SIZE)
    || new Set(setup.selectedTopics).size !== setup.selectedTopics.length
    || new Set(setup.topicQuotas.map((q) => q.topic)).size !== setup.topicQuotas.length
    || setup.topicQuotas.reduce((sum, q) => sum + q.count, 0) > MAX_RUN_SIZE) return null;
  return {
    version: 1, mode: setup.mode, total: setup.total,
    selectedTopics: [...setup.selectedTopics], topicQuotas: setup.topicQuotas.map(({ topic, count }) => ({ topic, count }))
  };
}

/** Keep choices for topics still present, without selecting new topics on the user's behalf. */
export function reconcileExamSetup(setup: ExamSetup, topics: ReadonlySet<string>): ExamSetup {
  return {
    ...setup,
    selectedTopics: setup.selectedTopics.filter((topic) => topics.has(topic)),
    topicQuotas: setup.topicQuotas.filter(({ topic }) => topics.has(topic)).map((quota) => ({ ...quota }))
  };
}
