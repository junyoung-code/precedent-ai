import { createHash } from "node:crypto";

const API_BASE = "https://www.law.go.kr/DRF";
const OFFICIAL_PAGE = "https://www.law.go.kr/LSW/precInfoP.do";

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
  constructor({ oc, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
    if (!oc) throw new LawOpenDataError("LAW_OPEN_DATA_APPROVAL_REQUIRED");
    this.oc = oc;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async listCandidates({ query, page = 1, display = 20 }) {
    const payload = await this.#get("lawSearch.do", {
      target: "prec", type: "JSON", search: "2", query, page, display,
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
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json();
    } catch (error) {
      throw new LawOpenDataError("LAW_API_UNAVAILABLE", error);
    }
  }
}
