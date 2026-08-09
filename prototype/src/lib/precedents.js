const LAW_GO = "https://www.law.go.kr/LSW/precInfoP.do";

export const VERIFIED_PRECEDENTS = Object.freeze([
  {
    id: "law-go-618503",
    provider: "law_go_verified_manual",
    providerRecordId: "618503",
    verified: true,
    court: "대법원",
    caseNumber: "2025도12709",
    caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2026-03-12",
    officialUrl: `${LAW_GO}?mode=0&precSeq=618503`,
    verifiedAt: "2026-08-09",
    facts: {
      medium: "bank_transfer",
      relationship: "unknown",
      context: "conflict",
      messageForm: "text",
      expressionType: "insult_with_sexual_terms",
      repetition: "repeated",
      reachedRecipient: "yes",
    },
    keywords: ["송금", "송금메모", "계좌", "1원", "성적", "욕설", "반복"],
    issueTags: ["통신매체", "도달", "성적표현"],
    summary: [
      {
        text: "휴대전화의 송금메모 기능도 상대방에게 정보를 전달하는 통신매체가 될 수 있다고 본 판례입니다.",
        sourceAnchor: "판시사항 [1]",
      },
      {
        text: "소액 송금과 함께 작성한 메모가 실제 상대방에게 전달된 과정이 중요한 비교 지점입니다.",
        sourceAnchor: "판시사항 [2]",
      },
    ],
  },
  {
    id: "law-go-182865",
    provider: "law_go_verified_manual",
    providerRecordId: "182865",
    verified: true,
    court: "대법원",
    caseNumber: "2015도17847",
    caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2016-03-10",
    officialUrl: `${LAW_GO}?precSeq=182865`,
    verifiedAt: "2026-08-09",
    facts: {
      medium: "direct_delivery",
      relationship: "neighbor",
      context: "one_sided",
      messageForm: "text",
      expressionType: "sexual_text",
      repetition: "repeated",
      reachedRecipient: "yes",
    },
    keywords: ["편지", "출입문", "직접", "이웃", "성적", "반복"],
    issueTags: ["통신매체", "직접전달", "성적표현"],
    summary: [
      {
        text: "통신매체를 이용하지 않고 출입문에 직접 편지를 끼워 넣은 행위까지 해당 조항으로 넓혀 해석할 수 없다고 본 판례입니다.",
        sourceAnchor: "판결요지",
      },
      {
        text: "표현 내용뿐 아니라 전달에 실제로 어떤 매체가 사용됐는지가 핵심 비교 지점입니다.",
        sourceAnchor: "판시사항",
      },
    ],
  },
  {
    id: "law-go-193032",
    provider: "law_go_verified_manual",
    providerRecordId: "193032",
    verified: true,
    court: "서울동부지방법원",
    caseNumber: "2016노147",
    caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2016-12-01",
    officialUrl: `${LAW_GO}?precSeq=193032`,
    verifiedAt: "2026-08-09",
    facts: {
      medium: "kakao",
      relationship: "acquaintance",
      context: "sexual_conversation",
      messageForm: "image",
      expressionType: "sexual_image",
      repetition: "once",
      reachedRecipient: "yes",
    },
    keywords: ["카카오톡", "사진", "나체", "동업", "연인", "전송"],
    issueTags: ["성적목적", "이미지", "도달"],
    summary: [
      {
        text: "카카오톡으로 나체 사진을 전송한 사실과 함께 당사자 관계 및 촬영·전송 경위를 종합해 목적을 살핀 하급심 판례입니다.",
        sourceAnchor: "이유 2. 가.",
      },
      {
        text: "이미지의 성격만으로 판단하지 않고 관계와 전송 당시의 맥락을 함께 검토했습니다.",
        sourceAnchor: "이유 1.",
      },
    ],
  },
  {
    id: "law-go-203022",
    provider: "law_go_verified_manual",
    providerRecordId: "203022",
    verified: true,
    court: "대법원",
    caseNumber: "2018도9775",
    caseName: "협박·성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2018-09-13",
    officialUrl: `${LAW_GO}?precSeq=203022`,
    verifiedAt: "2026-08-09",
    facts: {
      medium: "digital_message",
      relationship: "acquaintance",
      context: "conflict",
      messageForm: "text",
      expressionType: "insult_with_sexual_terms",
      repetition: "repeated",
      reachedRecipient: "yes",
    },
    keywords: ["성적", "비하", "조롱", "분노", "협박", "메시지"],
    issueTags: ["성적목적", "분노", "성적비하", "도달"],
    summary: [
      {
        text: "성적 욕망에는 상대방을 성적으로 비하하거나 조롱해 심리적 만족을 얻으려는 욕망도 포함될 수 있다고 설명한 판례입니다.",
        sourceAnchor: "판결요지",
      },
      {
        text: "분노가 섞였다는 사정만으로 성적 목적이 항상 배제되는 것은 아니며 관계·동기·수단·내용을 종합해야 한다고 보았습니다.",
        sourceAnchor: "판결요지",
      },
    ],
  },
  {
    id: "law-go-606693",
    provider: "law_go_verified_manual",
    providerRecordId: "606693",
    verified: true,
    court: "대법원",
    caseNumber: "2023도17539",
    caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2025-01-09",
    officialUrl: `${LAW_GO}?precSeq=606693`,
    verifiedAt: "2026-08-09",
    facts: {
      medium: "kakao",
      relationship: "game_user",
      context: "conflict",
      messageForm: "text",
      expressionType: "insult_with_sexual_terms",
      repetition: "once",
      reachedRecipient: "yes",
    },
    keywords: ["게임", "카카오톡", "처음", "다툼", "성적", "욕설", "한 번"],
    issueTags: ["성적목적", "분노", "단발성", "도달"],
    summary: [
      {
        text: "게임에서 처음 만난 상대와의 다툼 중 카카오톡으로 성적 욕설을 한 차례 보낸 사안입니다.",
        sourceAnchor: "이유 2. 공소사실",
      },
      {
        text: "대화의 전체 경위와 단발성 등을 고려해 분노 표출과 성적 목적을 구분해 살펴야 한다고 보았습니다.",
        sourceAnchor: "이유 4. 가.",
      },
    ],
  },
  {
    id: "law-go-608477",
    provider: "law_go_verified_manual",
    providerRecordId: "608477",
    verified: true,
    court: "대법원",
    caseNumber: "2025도986",
    caseName: "성폭력범죄의처벌등에관한특례법위반(통신매체이용음란)",
    decisionDate: "2025-08-14",
    officialUrl: `${LAW_GO}?mode=0&precSeq=608477`,
    verifiedAt: "2026-08-09",
    facts: {
      medium: "sns_mention",
      relationship: "online_user",
      context: "conflict",
      messageForm: "text",
      expressionType: "insult_with_sexual_terms",
      repetition: "once",
      reachedRecipient: "yes",
    },
    keywords: ["트위터", "SNS", "멘션", "차단", "게시글", "성적", "다툼"],
    issueTags: ["도달", "SNS", "멘션", "성적표현"],
    summary: [
      {
        text: "SNS에서 상대 계정을 멘션해 알림이 전달되고 게시물을 바로 확인할 수 있는 상태가 된 경우의 ‘도달’을 다룬 판례입니다.",
        sourceAnchor: "판시사항 [1]",
      },
      {
        text: "상대방이 실제로 내용을 읽었는지보다 객관적으로 인식할 수 있는 상태가 되었는지를 중요하게 보았습니다.",
        sourceAnchor: "판시사항 [2]",
      },
    ],
  },
]);

const REQUIRED_FIELDS = [
  "id",
  "providerRecordId",
  "court",
  "caseNumber",
  "caseName",
  "decisionDate",
  "officialUrl",
  "verifiedAt",
];

export function validatePrecedents(precedents) {
  const errors = [];
  const canonicalKeys = new Set();

  for (const precedent of precedents) {
    for (const field of REQUIRED_FIELDS) {
      if (!precedent[field]) errors.push(`${precedent.id || "unknown"}:${field}`);
    }

    if (precedent.verified !== true) errors.push(`${precedent.id}:not-verified`);
    if (!/^https:\/\/(www\.)?law\.go\.kr\//.test(precedent.officialUrl || "")) {
      errors.push(`${precedent.id}:untrusted-url`);
    }
    if (!Array.isArray(precedent.sourceAnchors) && !precedent.summary?.every((item) => item.sourceAnchor)) {
      errors.push(`${precedent.id}:missing-source-anchor`);
    }

    const canonicalKey = `${precedent.court}:${precedent.caseNumber}:${precedent.decisionDate}`;
    if (canonicalKeys.has(canonicalKey)) errors.push(`${precedent.id}:duplicate`);
    canonicalKeys.add(canonicalKey);
  }

  return errors;
}

// The public result model exposes anchors without copying the full judgment text.
for (const precedent of VERIFIED_PRECEDENTS) {
  precedent.sourceAnchors = precedent.summary.map((sentence) => sentence.sourceAnchor);
}
