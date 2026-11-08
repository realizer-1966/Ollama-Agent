// Laya(System 1)가 답하는 질문들. Laya는 절대 쓰지 않는다: 모든 질문은 다른 무언가(도구 등록부, 후보 추출기,
// 고정 목록)가 제안한 선택지 중 하나를 고르거나 예/아니오로 답하는 형태다.
import { TOOLS } from "./tools/index.js";
import { slotOptions, NONE } from "./candidates.js";

export const ARG_PREFIX = "arg:";

/**
 * Decision pass. next_action every step; goal_met from the second step on (nothing is gathered before that).
 * The risk question is about the GOAL, so it is asked once per run, on the goal alone (riskQuestion), which is cheap.
 */
export function actionQuestions(tools = TOOLS, stepIndex = 1) {
  const q = {
    next_action: {
      type: "choice",
      instructions: "이 목표를 위해 다음에 어떤 도구를 써야 하는가?",
      criteria: Object.fromEntries(tools.map((t) => [t.id, t.whenToUse])),
    },
  };
  if (stepIndex > 0) q.goal_met = { type: "noul", instructions: "마지막 관찰 결과에 목표에 대한 최종 답이 들어 있다" };
  return q;
}

export const riskQuestion = () => ({ risky: { type: "noul", instructions: "이 목표는 사용자를 대신해 무언가를 저장하거나 보내거나 지우거나 바꾸라고 한다" } });
export const riskState = (goal) => ({ goal });

/**
 * Argument pass: one choice question per slot of the chosen tool (options = spans + NONE, or a fixed list).
 * A slot with no candidate span at all is not asked (Laya needs at least two options); it is answered NONE directly.
 */
export function argQuestions(tool, cands) {
  const qs = {};
  for (const slot of tool?.slots || []) {
    const criteria = slotOptions(slot, cands);
    if (Object.keys(criteria).length >= 2) qs[ARG_PREFIX + slot.name] = { type: "choice", instructions: slot.instruction, criteria };
  }
  return qs;
}

/** Answers for slots that had no candidate span (see argQuestions). */
export function emptySlotAnswers(tool, cands) {
  const out = {};
  for (const slot of tool?.slots || []) {
    if (Object.keys(slotOptions(slot, cands)).length < 2) out[ARG_PREFIX + slot.name] = { type: "choice", choice: NONE, probabilities: { [NONE]: 1 }, confidence: 1, noCandidates: true };
  }
  return out;
}

/** Top-n options of a choice answer, best first: [{ key, p }]. */
export function topOptions(answer, n = 3) {
  return Object.entries(answer?.probabilities || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, p]) => ({ key, p }));
}
