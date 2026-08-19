import { createHash } from "node:crypto";
import { fetchLawText, maskSensitiveUrl } from "./law-http.mjs";

const API_BASE = "https://www.law.go.kr/DRF";
const OFFICIAL_PAGE = "https://www.law.go.kr/LSW/precInfoP.do";

// OC가 유효해도 요청 헤더가 부족하면 법제처가 돌려주는 거절 문서.
// 문구가 IP·도메인 등록 문제로 읽혀 승인 상태를 오해하기 쉬우므로 별도 코드로 구분한다.
const AUTH_REJECTION = /사용자\s*정보\s*검증에\s*실패/;

export class LawOpenDataError extends Error {
  constructor(code, cause) {
    super(code, { cause });
    this.code = code;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function date(value) {
  const raw = text(value);
  const normalized = /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : raw.replaceAll(".", "-").replace(/-+$/, "");
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

export function parsePrecedentList(payload) {
  const value = payload?.PrecSearch?.prec;
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map((row) => ({
    providerRecordId: text(row.판례일련번호 || row.ID || row.id),
    caseNumber: text(row.사건번호),
    caseName: text(row.사건명),
    court: text(row.법원명),
    decisionDate: date(row.선고일자 || row.선고일),
  })).filter((row) => row.providerRecordId);
}

export function parsePrecedentDetail(payload, providerRecordId) {
  const row = payload?.PrecService || payload?.판례 || payload;
  const recordId = text(row.판례정보일련번호 || row.판례일련번호 || providerRecordId);
  const sourceText = text(row.판례내용 || row.판결내용 || row.본문);
  const precedent = {
    provider: "law_open_data",
    providerRecordId: recordId,
    court: text(row.법원명),
    caseNumber: text(row.사건번호),
    caseName: text(row.사건명),
    decisionDate: date(row.선고일자 || row.선고일),
    officialUrl: `${OFFICIAL_PAGE}?precSeq=${encodeURIComponent(recordId)}`,
    sourceText,
    sourceHash: createHash("sha256").update(sourceText).digest("hex"),
  };

  const missing = ["providerRecordId", "court", "caseNumber", "caseName", "decisionDate", "sourceText"]
    .filter((field) => !precedent[field]);
  if (missing.length) throw new LawOpenDataError(`LAW_RECORD_INVALID:${missing.join(",")}`);
  return precedent;
}

export class LawOpenDataClient {
  constructor({ oc, timeoutMs = 30_000, ...http } = {}) {
    if (!oc) throw new LawOpenDataError("LAW_OPEN_DATA_APPROVAL_REQUIRED");
    this.oc = oc;
    this.http = { timeoutMs, ...http };
  }

  // search=1 matches the case name, search=2 the full judgment text. Full-text
  // matching pulls in judgments that merely cite the offence, so the caller has
  // to opt into it.
  async listCandidates({ query, page = 1, display = 20, search = "1" }) {
    const payload = await this.#get("lawSearch.do", {
      target: "prec", type: "JSON", search, query, page, display,
    });
    return {
      candidates: parsePrecedentList(payload),
      totalCount: Number(payload?.PrecSearch?.totalCnt || 0),
      raw: payload,
    };
  }

  async fetchDetail(providerRecordId) {
    const raw = await this.#get("lawService.do", {
      target: "prec", type: "JSON", ID: providerRecordId,
    });
    return { precedent: parsePrecedentDetail(raw, providerRecordId), raw };
  }

  async #get(path, parameters) {
    const url = new URL(`${API_BASE}/${path}`);
    url.search = new URLSearchParams({ OC: this.oc, ...parameters });

    let body;
    try {
      body = await fetchLawText(url.toString(), this.http);
    } catch (error) {
      throw new LawOpenDataError("LAW_API_UNAVAILABLE", error);
    }

    if (AUTH_REJECTION.test(body)) throw new LawOpenDataError("LAW_OPEN_DATA_AUTH_REJECTED");
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new LawOpenDataError(`LAW_RESPONSE_UNPARSABLE:${maskSensitiveUrl(url.pathname)}`, error);
    }
  }
}
