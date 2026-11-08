// send_message (시뮬레이션: 이 페이지는 실제로 아무것도 보내지 않는다), ask_user, FINISH.

export const sendMessage = {
  id: "send_message",
  whenToUse: "사용자를 대신해 다른 사람에게 메시지나 이메일을 보낸다",
  sideEffect: "다른 사람에게 메시지를 보냅니다 (이 데모에서는 시뮬레이션)",
  slots: [
    { name: "to", kinds: ["person", "proper"], instruction: "누구에게 메시지를 보내야 하는가?", none: "이 중에는 받을 사람이 없음" },
    { name: "text", kinds: ["clause"], instruction: "메시지에 무엇이라고 써야 하는가?", none: "이 중에는 메시지 내용이 없음" },
  ],
  async run({ to, text }) {
    const out = `${to}에게 보낼 메시지: "${text}" (데모이므로 실제로 전송되지 않았습니다)`;
    return { observation: out, answer: out, data: { to, text } };
  },
};

export const askUser = {
  id: "ask_user",
  whenToUse: "목표에 누가·무엇을·어디가 빠져 있을 때 사용자에게 되묻는다",
  slots: [],
  async run({ question }, ctx = {}) {
    const q = question || "조금 더 자세히 말씀해 주시겠어요?";
    const reply = ctx.askUser ? await ctx.askUser(q) : null;
    if (!reply) return { observation: `사용자에게 물었습니다: "${q}" (답 없음)`, answer: q, data: { question: q, reply: null }, ok: false };
    return { observation: `사용자가 답했습니다: "${reply}"`, answer: `말씀하신 내용: "${reply}"`, data: { question: q, reply } };
  },
};

export const finish = {
  id: "FINISH",
  whenToUse: "모은 정보가 이미 목표에 답하므로 멈춘다",
  slots: [],
  async run() { return { observation: "", answer: "", data: null }; },
};
