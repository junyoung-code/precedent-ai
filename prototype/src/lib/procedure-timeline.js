/**
 * 이후 절차 — what happens after this, described rather than advised.
 *
 * The one thing the readers this service is built for keep asking that no
 * amount of precedent data answers: what happens next. It is the same for
 * everyone, so nothing here is generated. A model wrote a version of this once
 * per reader, behind a plan, in sentences nobody had checked.
 *
 * Two rules hold the content in place, both enforced by tests:
 *
 *   Every 제N조 in a body is a link. An article number without a source is the
 *   kind of citation this service does not ship, and law read from memory is
 *   exactly where a confident wrong answer comes from.
 *
 *   Every line passes validateGroundedAnalysis — the same censor a model's
 *   sentences go through. That is what keeps this a description of a procedure
 *   rather than advice about a case, which is the line 변호사법 제109조 draws
 *   and the reason this can be shown at all.
 *
 * The two sides are not the same walk. A 고소인 starts by filing and waits to
 * be told; a 피고소인 starts by being told to appear. Reading one from the
 * other's position is the 상대방 confusion this product has had to remove
 * twice already.
 */

const LAW_BASE = "https://www.law.go.kr/법령";

function source(law, article) {
  return Object.freeze({
    label: `${law} ${article}`,
    // The site addresses an article by the law's name without spaces, the same
    // shape the statute sync already stores for 제13조.
    url: `${LAW_BASE}/${law.replace(/\s+/g, "")}/${article}`,
  });
}

const CRIMINAL_PROCEDURE = "형사소송법";
const VICTIM_PROTECTION = "범죄피해자 보호법";

// Shared by both sides, worded from each one's position where that differs.
const PROSECUTOR_STAGE = {
  id: "prosecutor",
  title: "검찰이 처분을 정합니다",
  body: "검사는 사건을 재판에 넘길지 정합니다. 형사소송법 제247조에 따라 여러 사정을 참작해 공소를 제기하지 않을 수도 있습니다. 수사 단계에서는 범죄피해자 보호법 제41조에 따라 검사가 사건을 형사조정에 회부할 수 있고, 회부할지는 검사가 정합니다.",
  sources: [source(CRIMINAL_PROCEDURE, "제247조"), source(VICTIM_PROTECTION, "제41조")],
};

const TRIAL_STAGE = {
  id: "trial",
  title: "재판에 넘겨지면 법원이 판단합니다",
  body: "공소가 제기되면 법원이 사건을 심리합니다. 이 화면에서 보신 판례들이 바로 이 단계에서 남은 기록입니다.",
  sources: [],
};

function freezeStages(stages) {
  return Object.freeze(stages.map((stage) => Object.freeze({
    ...stage,
    sources: Object.freeze([...stage.sources]),
  })));
}

export const PROCEDURE_STAGES = Object.freeze({
  victim: freezeStages([
    {
      id: "complaint",
      title: "고소장을 냅니다",
      body: "경찰서나 검찰청에 고소장을 냅니다. 형사소송법 제223조는 범죄로 인한 피해자가 고소할 수 있다고 정하고 있습니다. 접수되면 사건번호가 붙고 담당 수사관이 정해집니다.",
      sources: [source(CRIMINAL_PROCEDURE, "제223조")],
    },
    {
      id: "interview",
      title: "고소인 조사를 받습니다",
      body: "담당 수사관이 출석을 요청해 고소한 내용을 확인합니다. 무엇이 언제 어떤 경로로 오갔는지를 묻고, 진술한 내용은 조서로 남습니다.",
      sources: [],
    },
    {
      id: "police",
      title: "경찰이 송치 여부를 정합니다",
      body: "형사소송법 제245조의5에 따라, 경찰은 범죄 혐의가 있다고 보면 사건을 검사에게 넘기고(송치), 그렇지 않다고 보면 넘기지 않습니다(불송치).",
      sources: [source(CRIMINAL_PROCEDURE, "제245조의5")],
    },
    {
      id: "notice",
      title: "불송치되면 통지를 받고, 이의를 낼 수 있습니다",
      body: "불송치한 경우 경찰은 형사소송법 제245조의6에 따라 7일 안에 고소인에게 그 이유를 적은 서면으로 알립니다. 통지를 받은 사람은 제245조의7에 따라 해당 경찰관서의 장에게 이의를 신청할 수 있고, 이의신청이 있으면 사건은 검사에게 넘어갑니다.",
      sources: [source(CRIMINAL_PROCEDURE, "제245조의6"), source(CRIMINAL_PROCEDURE, "제245조의7")],
    },
    PROSECUTOR_STAGE,
    TRIAL_STAGE,
  ]),

  reported: freezeStages([
    {
      id: "summons",
      title: "출석요구를 받습니다",
      body: "형사소송법 제200조는 검사 또는 사법경찰관이 수사에 필요한 때에 피의자의 출석을 요구해 진술을 들을 수 있다고 정합니다. 통지에는 언제 어디로 나오면 되는지와 담당 수사관이 적혀 있습니다.",
      sources: [source(CRIMINAL_PROCEDURE, "제200조")],
    },
    {
      id: "interview",
      title: "피의자 조사를 받습니다",
      body: "무엇이 언제 어떤 경로로 오갔는지를 묻습니다. 진술한 내용은 조서로 남습니다.",
      sources: [],
    },
    {
      id: "police",
      title: "경찰이 송치 여부를 정합니다",
      body: "형사소송법 제245조의5에 따라, 경찰은 범죄 혐의가 있다고 보면 사건을 검사에게 넘기고(송치), 그렇지 않다고 보면 넘기지 않습니다(불송치). 불송치된 사건도 고소인이 제245조의7에 따라 이의를 신청하면 검사에게 넘어갑니다.",
      sources: [source(CRIMINAL_PROCEDURE, "제245조의5"), source(CRIMINAL_PROCEDURE, "제245조의7")],
    },
    PROSECUTOR_STAGE,
    TRIAL_STAGE,
  ]),
});

/**
 * Said under the heading, where the badge is.
 *
 * AI 생성 아님 on its own says what this is not. What a reader needs to know
 * is what it is: written once from the statutes, and the same for everyone —
 * which is exactly how it differs from the two cards above it, both of which
 * are about this reader's own case.
 *
 * Visible rather than a tooltip. Most of these readers arrive on a phone,
 * where there is no hover, and a service whose claim is that it marks what a
 * model wrote cannot put the marking behind a mouse.
 */
export const PROCEDURE_LEAD = "조문을 근거로 미리 작성한 안내이며, 모든 이용자에게 같은 내용이 표시됩니다.";

/**
 * Said once, under the whole timeline. The panel is the one place on the
 * result screen that is not about this reader's case, and a procedure read as
 * an instruction is the thing this may not become.
 */
export const PROCEDURE_CAUTION = "절차가 보통 어떻게 진행되는지에 대한 안내이며, 회원님 사건의 결과나 대응 방법을 알려드리는 것이 아닙니다.";

/**
 * The walk for one side, or nothing.
 *
 * No default side. A procedure told from the wrong position is worse than no
 * procedure: it tells a reader waiting for a notice that they should be
 * filing, and the reader who has already been summoned that nothing has
 * started yet.
 */
export function procedureStages(role) {
  return PROCEDURE_STAGES[role] || null;
}
