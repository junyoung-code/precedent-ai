import { useEffect, useMemo, useRef, useState } from "react";
import { extractCaseFacts } from "./lib/search.js";
import { redactSensitiveText } from "./lib/privacy-redaction.js";
import { abandonIntake, answerIntake, cancelIntake, completeIntake, createIntake } from "./lib/intake-api.js";
import { analyseCase, fetchWebCases } from "./lib/analysis-api.js";
import { WEB_SOURCE_TYPE_LABEL } from "./lib/web-case-vocab.js";

const FACT_LABELS = {
  medium: {
    bank_transfer: "송금메모",
    kakao: "카카오톡",
    game_chat: "게임 채팅",
    sns_mention: "SNS 멘션",
    direct_delivery: "직접 전달",
    digital_message: "디지털 메시지",
    unknown: "매체 미확인",
  },
  relationship: {
    game_user: "게임 이용자",
    acquaintance: "지인",
    partner_or_ex: "연인·전 연인",
    neighbor: "이웃",
    stranger: "모르는 사이",
    online_user: "온라인 이용자",
    unknown: "관계 미확인",
  },
  context: {
    conflict: "다툼 상황",
    sexual_conversation: "성적 대화 맥락",
    one_sided: "일방적 전달",
    unknown: "맥락 미확인",
  },
  messageForm: { text: "글", image: "이미지" },
  repetition: { once: "한 차례", repeated: "반복", unknown: "횟수 미확인" },
};

function SideNavigation({ view, onNewCase }) {
  const items = [
    { icon: "⌂", label: "사례 분석", active: true },
    { icon: "◎", label: "판례 범위" },
    { icon: "↻", label: "검증 기록" },
    { icon: "?", label: "이용 안내" },
  ];

  return (
    <aside className="side-navigation" aria-label="주요 메뉴">
      <button className="brand-mark" type="button" onClick={onNewCase} aria-label="판례AI 홈">
        <span className="brand-spark">✦</span>
      </button>
      <nav className="nav-stack">
        {items.map((item) => (
          <button
            className={`nav-item ${item.active ? "is-active" : ""}`}
            key={item.label}
            type="button"
            onClick={item.active ? onNewCase : undefined}
            aria-current={item.active && view === "home" ? "page" : undefined}
            title={item.label}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="nav-bottom">
        <div className="privacy-dot" title="가려진 입력만 최대 1시간 임시 저장">
          <span aria-hidden="true">◉</span>
          <span className="nav-label">1시간 내 삭제</span>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ onNewCase, availableCount }) {
  return (
    <header className="top-bar">
      <button className="product-switcher" type="button" onClick={onNewCase}>
        <span className="tiny-spark" aria-hidden="true">✦</span>
        <span>판례AI · 통매음</span>
        <span className="chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="top-actions">
        <div className="verified-status">
          <span className="status-dot" aria-hidden="true" />
          {availableCount == null ? "공식 판례 DB 연결" : `공식 판례 ${availableCount}건 검색 가능`}
        </div>
      </div>
    </header>
  );
}

function RoleSelector({ value, onChange }) {
  const roles = [
    { value: "victim", label: "피해자" },
    { value: "reported", label: "피신고인(피의자)" },
  ];

  return (
    <div className="role-segment" role="group" aria-label="사례를 살펴볼 입장">
      {roles.map((item) => (
        <button
          type="button"
          key={item.value}
          className={`role-segment-button ${value === item.value ? "is-selected" : ""}`}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const SEARCH_STEPS = [
  "입력에서 이름·연락처를 가렸습니다",
  "검증된 공개 판례와 사실관계를 비교하고 있습니다",
  "닮은 점과 다른 점을 정리하고 있습니다",
];

/**
 * The wait before the result appears. A search takes a second or two and the
 * statute reading about ten, so a single line of text reads as a stall; the
 * steps say which part is running.
 */
function SearchProgress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((current) => Math.min(current + 1, SEARCH_STEPS.length - 1)), 420);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="search-progress" role="status" aria-live="polite">
      <div className="search-progress-bar" aria-hidden="true"><span /></div>
      <ol className="search-progress-steps">
        {SEARCH_STEPS.map((text, index) => (
          <li key={text} className={index === step ? "is-active" : index < step ? "is-done" : ""}>
            <span className="search-progress-mark" aria-hidden="true">{index < step ? "✓" : "•"}</span>
            {text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CaseComposer({
  role,
  onRoleChange,
  description,
  onDescriptionChange,
  onSubmit,
  analyzing,
  allowExternalAi,
  onExternalAiChange,
  intake,
  onStartIntake,
  onSubmitAnswers,
  onCancelIntake,
}) {
  const fileInputRef = useRef(null);
  const captureNoticeRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [answers, setAnswers] = useState({});
  const [dragging, setDragging] = useState(false);
  const [captureNotice, setCaptureNotice] = useState(false);
  const [captureConfirmed, setCaptureConfirmed] = useState(false);
  const ready = role && description.trim().length >= 15 && !analyzing;

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // The notice can sit below the fold, where a blocked submit would look like nothing happened.
  useEffect(() => {
    if (!captureNotice || !captureNoticeRef.current) return;
    captureNoticeRef.current.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
  }, [captureNotice]);

  function acceptFile(nextFile) {
    setFileError("");
    if (!nextFile) return false;
    if (!/^image\/(png|jpeg|webp)$/.test(nextFile.type)) {
      setFileError("PNG, JPG, WEBP 이미지만 첨부할 수 있습니다.");
      return false;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setFileError("이미지 크기는 10MB 이하여야 합니다.");
      return false;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setCaptureNotice(false);
    setCaptureConfirmed(false);
    return true;
  }

  function handleFile(event) {
    if (!acceptFile(event.target.files?.[0])) event.target.value = "";
  }

  // Screenshots usually live on the clipboard, not on disk, so accept Ctrl+V too.
  function handlePaste(event) {
    const image = [...(event.clipboardData?.items || [])]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (!image) return;
    const pasted = image.getAsFile();
    if (!pasted) return;
    event.preventDefault();
    acceptFile(pasted);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    acceptFile([...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/")));
  }

  function handleDragOver(event) {
    if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  }

  function removeFile() {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    // The transcript panel disappears with the capture, so keeping its text would
    // submit something the user can no longer see or edit.
    setTranscript("");
    setCaptureNotice(false);
    setCaptureConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function runSubmit() {
    onStartIntake(redactSensitiveText([description, transcript].filter(Boolean).join("\n")).text);
  }

  function submit(event) {
    event.preventDefault();
    if (!ready) return;
    // The capture never leaves the browser, so an untranscribed one contributes nothing.
    if (file && !transcript.trim() && !captureConfirmed) {
      setCaptureNotice(true);
      return;
    }
    runSubmit();
  }

  function submitWithoutTranscript() {
    setCaptureConfirmed(true);
    setCaptureNotice(false);
    runSubmit();
  }

  return (
    <div className="composer-stack">
      <form
        className={`composer${dragging ? " is-dragging" : ""}`}
        onSubmit={submit}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <textarea
          id="case-description"
          aria-label="사례 설명"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value.slice(0, 2000))}
          placeholder="상황·매체·관계·횟수를 시간 순서대로 적어주세요."
          rows={7}
        />
        <div className="composer-toolbar">
          <div className="composer-tools-primary">
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFile}
              id="case-image"
            />
            <label className="attach-button" htmlFor="case-image" title="캡처를 붙여넣거나(Ctrl+V) 끌어다 놓아도 됩니다">
              <span aria-hidden="true">⌕</span> 대화 캡처 첨부
            </label>
            <RoleSelector value={role} onChange={onRoleChange} />
            {file && (
              <button className="file-chip" type="button" onClick={removeFile} aria-label={`${file.name} 삭제`} title="클릭하면 첨부가 삭제됩니다">
                {file.name} <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
          <div className="submit-area">
            <span className="character-count">{description.length}/2,000</span>
            <button
              className="analyze-button"
              type="submit"
              disabled={!ready}
              aria-label={analyzing ? "판례 비교 중" : "비슷한 판례 찾기"}
            >
              <span aria-hidden="true">{analyzing ? "…" : "↑"}</span>
            </button>
          </div>
        </div>
      </form>
      {fileError && <p className="file-error" role="alert">{fileError}</p>}
      {file && <section className="capture-review" aria-label="대화 캡처 검토">
        {previewUrl && <div className="capture-preview">
          <img src={previewUrl} alt="선택한 대화 캡처 미리보기" />
          <button type="button" className="capture-remove" onClick={removeFile} aria-label="첨부한 캡처 삭제" title="첨부한 캡처 삭제">
            <span aria-hidden="true">×</span>
          </button>
        </div>}
        <label htmlFor="capture-transcript">캡처의 필요한 내용을 직접 입력하거나 수정하세요</label>
        <textarea id="capture-transcript" value={transcript} onChange={(event) => { setTranscript(event.target.value.slice(0, 4000)); setCaptureNotice(false); }} placeholder="캡처의 필요한 문장을 입력하세요. 이름·연락처는 가려집니다." rows={4} />
        <p>캡처 이미지는 서버 또는 외부 AI에 전송하지 않습니다. 옮겨 적은 문장만 검색에 사용됩니다.</p>
        {captureNotice && <div className="capture-notice" role="alert" ref={captureNoticeRef}>
          <p>캡처를 아직 옮겨 적지 않았습니다. 이미지는 읽지 않으므로 지금 검색하면 캡처 내용은 반영되지 않습니다.</p>
          <button type="button" onClick={submitWithoutTranscript}>캡처 없이 검색</button>
        </div>}
      </section>}
      {intake.questions.length > 0 && <section className="intake-questions" aria-label="추가 사실 확인">
        <div className="intake-head">
          <h2>몇 가지만 더 확인할게요</h2>
          <p>적어주신 내용에서 읽어내지 못한 것만 여쭙습니다. 모르시면 비워두셔도 됩니다.</p>
        </div>
        {intake.questions.map((question) => <label key={question.id} htmlFor={`intake-${question.id}`}>
          <span className="intake-prompt">{question.prompt}</span>
          {question.hint && <span className="intake-hint">{question.hint}</span>}
          <input
            id={`intake-${question.id}`}
            value={answers[question.id] || ""}
            onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
          />
        </label>)}
        <div className="intake-actions"><button type="button" onClick={onCancelIntake}>취소하고 입력 지우기</button><button type="button" className="analyze-button intake-complete" disabled={analyzing} onClick={() => onSubmitAnswers(answers)}>확인 후 검색</button></div>
      </section>}
      {analyzing && <SearchProgress />}
      <label className="embedding-consent">
        <input
          type="checkbox"
          checked={allowExternalAi}
          onChange={(event) => onExternalAiChange(event.target.checked)}
        />
        <span>
          <strong>AI 분석 사용</strong>
          가려진 입력 문장을 OpenAI API로 전송해 의미 검색, 법조문 분석, 비슷한 사례 웹 검색에 사용합니다.
          <small>동의하지 않으면 키워드·사실 태그 검색만 사용하고 AI 분석은 실행하지 않습니다. 웹 검색은 회원님 문장을 그대로 쓰지 않고 상황을 일반화한 검색어로 실행합니다. 입력은 서비스 DB에 저장하지 않습니다.</small>
        </span>
      </label>
      <div className="composer-notices" aria-label="서비스 안내">
        <p><span aria-hidden="true">✦</span> AI가 공개 판례를 검색·비교합니다.</p>
        <p><span aria-hidden="true">◉</span> 입력은 검색 후 바로 삭제되며, 중단된 입력은 최대 1시간 뒤 삭제됩니다.</p>
      </div>
    </div>
  );
}

function HomeView({
  role,
  setRole,
  description,
  setDescription,
  onSubmit,
  analyzing,
  allowExternalAi,
  setAllowExternalEmbedding,
  intake,
  onStartIntake,
  onSubmitAnswers,
  onCancelIntake,
  homeStartRef,
}) {
  return (
    <section className="home-view" ref={homeStartRef}>
      <div className="hero">
        <div className="hero-medallion" aria-hidden="true">
          <img src="/assets/gavel.png" alt="" />
        </div>
        <p className="eyebrow">검증된 공개 판례 기반</p>
        <h1>내 사례와 닮은 판례를<br /><span>사실관계로 비교해보세요</span></h1>
        <p className="hero-copy">법적 결론을 예측하지 않습니다. 공식 판례와 닮은 점·다른 점을 확인할 수 있습니다.</p>
      </div>
      <CaseComposer
        role={role}
        onRoleChange={setRole}
        description={description}
        onDescriptionChange={setDescription}
        onSubmit={onSubmit}
        analyzing={analyzing}
        allowExternalAi={allowExternalAi}
        onExternalAiChange={setAllowExternalEmbedding}
        intake={intake}
        onStartIntake={onStartIntake}
        onSubmitAnswers={onSubmitAnswers}
        onCancelIntake={onCancelIntake}
      />
    </section>
  );
}

function ScoreRing({ score }) {
  return (
    <div className="score-ring" style={{ "--score": `${score * 3.6}deg` }} aria-label={`사실관계 유사도 ${score}점`}>
      <div><strong>{score}</strong><span>/100</span></div>
    </div>
  );
}

// A summary is only generated for precedents about this offence alone. Mixing
// other charges into one summary risks presenting their reasoning as this one's.
const SUMMARY_ABSENCE_REASON = {
  mixed: "다른 죄명이 함께 판단된 판례여서 요약을 제공하지 않습니다. 공식 원문을 확인하세요.",
  peripheral: "이 사건의 주된 죄명이 통신매체이용음란이 아니어서 요약을 제공하지 않습니다. 공식 원문을 확인하세요.",
  focused: "이 판례는 아직 요약이 준비되지 않았습니다. 공식 원문을 확인하세요.",
};

// What a court order means in plain words. The order itself is quoted above the
// line, so this only names the kind of decision — the part a reader outside the
// profession cannot tell apart. An order carrying several decisions at once is
// not summarised into one; the reader is sent back to the quote.
const DISPOSITION_MEANING = {
  remand: "상급 법원이 앞선 판단을 그대로 두기 어렵다고 보아, 사건을 다시 재판하도록 돌려보냈습니다. 이 시점에 결론이 확정된 것은 아닙니다.",
  final_appeal_dismissed: "상고가 받아들여지지 않아 앞선 판단이 그대로 확정됐습니다.",
  appeal_dismissed: "항소가 받아들여지지 않아 앞선 판단이 그대로 유지됐습니다.",
  acquitted: "법원은 무죄로 판단했습니다.",
  sentenced: "법원이 유죄로 보아 위와 같은 형을 정했습니다. 상급심에서 달라질 수 있습니다.",
  reversed_and_sentenced: "앞선 판결을 파기하고 위와 같이 형을 다시 정했습니다.",
  multiple: "하나의 주문에 여러 갈래의 판단이 함께 담겨 있습니다. 위 원문을 그대로 확인하세요.",
  civil: "형사 판결이 아니라, 손해배상 등 금전 지급을 정한 민사 판결입니다.",
  other: "위 주문 원문을 그대로 확인하세요.",
};

// The same reason a mixed precedent carries no summary applies to its order.
const DISPOSITION_SCOPE_CAVEAT = "이 판례는 다른 죄명도 함께 판단되어, 위 주문이 통신매체이용음란 부분만의 결론은 아닙니다.";

function PrecedentCard({ result, rank }) {
  return (
    <article className="precedent-card">
      <div className="card-topline">
        <span className="rank-badge">{rank}</span>
        <div className="case-identity">
          <div className="verified-label"><span aria-hidden="true">✓</span> 공식 출처 확인</div>
          <h3>{result.court} {result.caseNumber}</h3>
          <p>{result.decisionDate} · {result.caseName}</p>
        </div>
        <ScoreRing score={result.similarity.total} />
      </div>

      <div className="score-breakdown" aria-label="유사도 구성">
        <span>의미 <strong>{result.similarity.semantic}</strong></span>
        <span>사실 태그 <strong>{result.similarity.facts}</strong></span>
        <span>쟁점 <strong>{result.similarity.issues}</strong></span>
        <small>45% + 45% + 10%</small>
      </div>

      <div className="comparison-grid">
        <section className="comparison-box similarities-box">
          <h4><span aria-hidden="true">≈</span> 닮은 점</h4>
          {result.similarities.length ? (
            <ul>{result.similarities.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>명확히 일치하는 구조화 사실이 적습니다.</p>}
        </section>
        <section className="comparison-box differences-box">
          <h4><span aria-hidden="true">≠</span> 다른 점</h4>
          {result.differences.length ? (
            <ul>{result.differences.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>입력에서 확인된 주요 사실은 대체로 유사합니다.</p>}
        </section>
      </div>

      {result.summary?.length > 0 && (
        <section className="summary-box" aria-labelledby={`summary-${result.id}`}>
          <div className="summary-heading">
            <div>
              <span className="ai-summary-badge">AI 생성 요약</span>
              <h4 id={`summary-${result.id}`}>판례에서 중요하게 본 부분</h4>
            </div>
            <span className="grounded-badge">근거 위치 연결됨</span>
          </div>
          <ul className="summary-list">
            {result.summary.map((sentence) => (
              <li key={sentence.text}>
                <p>{sentence.text}</p>
                <span>{sentence.sourceAnchor}</span>
              </li>
            ))}
          </ul>
          <p className="source-reminder">AI가 판결문을 요약한 내용입니다. 정확한 내용은 공식 원문을 확인하십시오.</p>
        </section>
      )}

      {!result.summary?.length && (
        <p className="summary-absent">{SUMMARY_ABSENCE_REASON[result.focus] || SUMMARY_ABSENCE_REASON.focused}</p>
      )}

      {result.disposition && (
        <section className="disposition-box" aria-labelledby={`disposition-${result.id}`}>
          <h4 id={`disposition-${result.id}`}>이 판례의 결론</h4>
          <blockquote className="disposition-order">{result.disposition.orderText}</blockquote>
          <p className="disposition-meaning">
            {DISPOSITION_MEANING[result.disposition.kind] || DISPOSITION_MEANING.other}
          </p>
          {result.focus !== "focused" && <p className="disposition-meaning">{DISPOSITION_SCOPE_CAVEAT}</p>}
          <p className="source-reminder">판결문 주문을 그대로 옮긴 것이며, 회원님 사건의 결과를 예측한 것이 아닙니다.</p>
        </section>
      )}

      <div className="card-actions">
        <span>국가법령정보센터 · {result.verifiedAt ? `${result.verifiedAt} 확인` : "공식 링크 확인"}</span>
        <a href={result.officialUrl} target="_blank" rel="noopener noreferrer">
          공식 원문 보기 <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}

const SEARCH_MODE_LABELS = {
  hybrid_embeddings: "임베딩·사실 태그 검색",
  fallback_without_embeddings: "키워드·사실 태그 fallback",
  provisional_without_embeddings: "키워드·사실 태그 검색",
};

function Coverage({ resultCount, coverage }) {
  return (
    <div className="coverage-panel">
      <div className="coverage-stat">
        <span>검색 가능</span>
        <strong>{coverage.availableCount}건</strong>
      </div>
      <div className="coverage-divider" />
      <div className="coverage-copy">
        <strong>국가법령정보센터 공식 공개 판례</strong>
        <p>{SEARCH_MODE_LABELS[coverage.scoring?.status] || "검증된 DB 검색"} · 이번 요청에서 {coverage.comparedCount}건을 비교했습니다.</p>
      </div>
      <div className="coverage-result">기준 이상 <strong>{resultCount}건</strong></div>
    </div>
  );
}

function EmptyResults({ onRevise, availableCount }) {
  return (
    <div className="empty-results">
      <div className="empty-orb" aria-hidden="true">∅</div>
      <p>검색 가능한 {availableCount}건 전부와 비교했지만 기준 이상인 판례가 없었습니다. 없는 판례를 만들어 보여주지 않습니다.</p>
      <button type="button" onClick={onRevise}>사례를 더 구체적으로 작성하기</button>
    </div>
  );
}

function ErrorResults({ onRetry }) {
  return (
    <div className="empty-results error-results" role="alert">
      <div className="empty-orb" aria-hidden="true">!</div>
      <h2>검색 서버에 연결하지 못했습니다</h2>
      <p>판례를 임의로 만들어 대신 보여주지 않습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.</p>
      <button type="button" onClick={onRetry}>다시 검색하기</button>
    </div>
  );
}

const MENTION_LABEL = {
  present: "입력에 언급됨",
  absent: "아니라고 적음",
  unclear: "입력만으로는 확인 안 됨",
};

const ANALYSIS_ABSENCE_REASON = {
  ANALYSIS_DISABLED: "AI 분석에 동의하지 않으셨습니다. 입력 화면에서 'AI 분석 사용'을 체크하면 법조문 정리를 볼 수 있습니다.",
  STATUTE_MISSING: "법조문을 아직 내려받지 못했습니다.",
  ANALYSIS_API_UNAVAILABLE: "AI 분석 서버에 연결하지 못했습니다. 위 판례 결과는 그대로 유효합니다.",
  ANALYSIS_RESPONSE_INVALID: "AI 분석 응답을 확인하지 못했습니다. 위 판례 결과는 그대로 유효합니다.",
};

const ANALYSIS_LOCKED_REASON = "ANALYSIS_REQUIRES_PLAN";

/**
 * The shape of what a plan adds, with none of it written.
 *
 * The bars are not covering hidden text — the server never called a model for
 * this reader, so there are no sentences to uncover. That is why the blur can
 * be a plain visual cue rather than a defence: a reader opening the network tab
 * finds the same nothing the screen shows.
 */
function LockedNotes({ rows = 2 }) {
  return (
    <div className="locked-lines" aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => <span key={row} className="locked-line" />)}
    </div>
  );
}

/**
 * Everything below the verified cards, split so a reader can tell what each
 * panel is. The statute panel quotes the article; the summary panel is text a
 * model wrote about it. Kept in separate tabs rather than one long scroll, which
 * also stops the two from reading as one continuous document.
 */
function AnalysisPlaceholder({ state }) {
  // The real wait in this product. The search settles in about a second; reading
  // the statute takes ten, and a lone spinner for that long reads as a hang.
  if (state.loading) {
    return (
      <div className="analysis-loading" role="status" aria-live="polite">
        <div className="search-progress-bar" aria-hidden="true"><span /></div>
        <p>법조문과 회원님이 적은 내용을 하나씩 맞춰보고 있습니다.</p>
        <p className="analysis-loading-note">보통 10초쯤 걸립니다. 판례 화면은 먼저 보실 수 있습니다.</p>
        <div className="skeleton-list" aria-hidden="true">
          {[0, 1, 2, 3].map((row) => <div key={row} className="skeleton-row" />)}
        </div>
      </div>
    );
  }
  return <p className="analysis-status">{ANALYSIS_ABSENCE_REASON[state.unavailable] || ANALYSIS_ABSENCE_REASON.ANALYSIS_API_UNAVAILABLE}</p>;
}

/**
 * What a plan adds, described rather than teased.
 *
 * It sits under the blurred shape rather than over it, because a notice laid on
 * top of a blur leaves both unreadable. And it says what the reader would get
 * in the same terms the product uses everywhere else — an explanation of the
 * article, not an answer about their case, which is not for sale either.
 */
function PlanNotice() {
  return (
    <div className="plan-notice">
      <p className="plan-notice-head"><span aria-hidden="true">🔒</span> 유료 이용 시 제공되는 내용입니다</p>
      <ul className="plan-notice-list">
        <li>각 요건이 무슨 뜻인지, 회원님이 적은 내용의 어느 부분이 거기 닿는지 AI가 풀어서 설명합니다</li>
        <li>검색된 판례가 회원님 상황과 어디가 닮고 어디가 다른지 정리해 드립니다</li>
        <li>기록을 어떻게 정리해두면 좋을지 안내합니다</li>
      </ul>
      <p className="plan-notice-foot">
        위 조문과 요건 표시, 그리고 판례·비슷한 사례는 무료입니다.
        유료 내용도 회원님 사건의 결론을 알려드리는 것이 아니라 조문을 풀어 설명하는 것입니다.
      </p>
    </div>
  );
}

function StatutePanel({ state }) {
  const { statute, elements, analysis } = state;
  if (!statute) return <AnalysisPlaceholder state={state} />;
  const noteFor = (id) => analysis?.elementNotes.find((item) => item.id === id)?.text;
  // The article is public law and the verdicts come from the rules, so both are
  // free to produce and shown either way. Only the explanation is behind a plan.
  const locked = state.unavailable === ANALYSIS_LOCKED_REASON;

  return (
    <div className="analysis-card">
      <blockquote className="statute-body">{statute.body}</blockquote>
      <p className="statute-source">
        {statute.lawName} · {statute.enforcedOn} 시행 ·{" "}
        <a href={statute.officialUrl} target="_blank" rel="noopener noreferrer">조문 원문 <span aria-hidden="true">↗</span></a>
      </p>

      <ul className="element-list">
        {elements.map((element) => (
          <li key={element.id} className={`element-item is-${element.mention}`}>
            <div className="element-head">
              <strong>{element.label}</strong>
              <span className={`element-mention is-${element.mention}`}>{MENTION_LABEL[element.mention]}</span>
            </div>
            <p className="element-quote">“{element.statuteQuote}”</p>
            <p className="element-evidence"><span aria-hidden="true">▸</span> {element.evidence}</p>
            {locked
              ? <LockedNotes rows={2} />
              : noteFor(element.id) && (
                <p className="element-note"><span className="ai-tag">AI</span> {noteFor(element.id)}</p>
              )}
          </li>
        ))}
      </ul>

      <p className="analysis-caution">
        <strong>각 항목은 회원님이 적은 내용에 그 요건이 언급되었는지만 표시한 것입니다.</strong>
        {" "}요건이 실제로 충족되는지는 증거를 확인한 뒤 법원이 판단합니다.
      </p>

      {locked && <PlanNotice />}
    </div>
  );
}

/**
 * Posts by people in the same situation, which is what most readers came for —
 * and the least reliable thing on the page. The warning is not a footnote: a
 * community answer about whether something is a crime is wrong often enough
 * that a reader who takes one as an answer is worse off than before.
 */
function WebCasesPanel({ state }) {
  if (state?.loading) {
    return (
      <div className="analysis-card web-cases">
        <h3>비슷한 상황을 겪은 사람들의 글</h3>
        <div className="skeleton-list" aria-hidden="true">
          {[0, 1, 2].map((row) => <div key={row} className="skeleton-row" />)}
        </div>
      </div>
    );
  }
  const webCases = state?.webCases || [];
  if (webCases.length === 0) return null;
  const fetchedOn = state?.fetchedAt ? new Date(state.fetchedAt) : null;
  return (
    <div className="analysis-card web-cases">
      <h3>비슷한 상황을 겪은 사람들의 글</h3>
      <p className="web-cases-warning">
        <strong>개인이 인터넷에 쓴 글입니다. 법적으로 정확하지 않을 수 있습니다.</strong>
        {" "}판단의 근거로 삼지 마시고, 참고만 하십시오. 위 판례 화면의 기록과는 성격이 완전히 다릅니다.
      </p>
      <ul className="web-case-list">
        {webCases.map((item) => (
          <li key={item.url} className="web-case">
            <span className="web-case-type">{WEB_SOURCE_TYPE_LABEL[item.sourceType] || "웹"}</span>
            <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
              {item.title} <span aria-hidden="true">↗</span>
            </a>
            <p className="web-case-quote"><span className="ai-tag">AI</span> {item.quote}</p>
          </li>
        ))}
      </ul>
      <p className="source-reminder">
        AI가 웹에서 찾아온 글이며, 서버가 각 주소에 실제로 접속해 존재를 확인한 것만 남겼습니다. 요약은 AI가 쓴 것이므로 원문을 직접 확인하십시오.
        {fetchedOn && ` ${fetchedOn.getMonth() + 1}월 ${fetchedOn.getDate()}일 기준입니다.`}
      </p>
    </div>
  );
}

function AiSummaryPanel({ state }) {
  const { analysis } = state;
  if (!analysis) {
    if (state.unavailable !== ANALYSIS_LOCKED_REASON) return <AnalysisPlaceholder state={state} />;
    return (
      <div className="analysis-card">
        <h3>회원님 상황 정리</h3>
        <LockedNotes rows={3} />
        <h3 className="locked-heading">지금 해두면 좋은 것</h3>
        <LockedNotes rows={3} />
        <PlanNotice />
      </div>
    );
  }

  return (
    <>
      {analysis.overview.length > 0 && (
        <div className="analysis-card">
          <h3>회원님 상황 정리</h3>
          {analysis.overview.map((text) => <p key={text}>{text}</p>)}
          {analysis.precedentNotes.length > 0 && (
            <ul className="analysis-precedent-notes">
              {analysis.precedentNotes.map((note) => (
                <li key={note.text}><span className="analysis-case">{note.caseNumber}</span> {note.text}</li>
              ))}
            </ul>
          )}
          <p className="source-reminder">AI가 위 조문과 검색된 판례만 근거로 쓴 설명입니다. 법률 자문이 아닙니다.</p>
        </div>
      )}

      {analysis.nextSteps.length > 0 && (
        <div className="analysis-card">
          <h3>지금 해두면 좋은 것</h3>
          <ul className="next-steps">{analysis.nextSteps.map((text) => <li key={text}>{text}</li>)}</ul>
          <p className="source-reminder">자료를 정리하는 방법에 관한 안내이며, 법적 조치를 권하는 것이 아닙니다.</p>
        </div>
      )}
    </>
  );
}

/**
 * Says out loud that the text on screen came from a stored response.
 *
 * Offline mode exists so the screens can be opened a hundred times for free,
 * which also means a hundred chances to read canned sentences as a real result
 * or to put one in a screenshot. It is fixed to the corner rather than in the
 * flow so it never moves the layout being worked on.
 */
function OfflineBadge({ shown }) {
  if (!shown) return null;
  return (
    <p className="offline-badge" role="status">
      오프라인 모드 · 저장된 응답입니다
    </p>
  );
}

function motionBehavior() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

const RESULT_SCREENS = [
  { id: "precedents", title: "닮은 판례", generated: false },
  { id: "statute", title: "법조문에 비춰본 내 상황", generated: true },
  { id: "summary", title: "AI가 정리한 내 사건", generated: true },
];

/**
 * Moves through the result one screen at a time.
 *
 * Every screen stays in the document even while hidden: saving the result has
 * to save all three, not whichever one happened to be open. Only the visible
 * one animates, so the deck is as tall as what is on screen rather than as
 * tall as its longest screen.
 */
function ResultDeck({ precedents, resultCount, analysisState, webCasesState, onNewCase }) {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState("forward");
  const deckRef = useRef(null);
  const state = analysisState || { loading: false, statute: null, elements: [], analysis: null, unavailable: "ANALYSIS_DISABLED" };

  function go(next) {
    if (next < 0 || next >= RESULT_SCREENS.length) return;
    setDirection(next > index ? "forward" : "back");
    setIndex(next);
    deckRef.current?.scrollIntoView({ behavior: motionBehavior(), block: "start" });
  }

  function onKeyDown(event) {
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
  }

  const previous = RESULT_SCREENS[index - 1];
  const next = RESULT_SCREENS[index + 1];
  const panels = {
    precedents,
    statute: (
      <>
        <p className="screen-lead">AI가 아래 법조문을 회원님이 적은 내용과 하나씩 맞춰본 것입니다.</p>
        <StatutePanel state={state} />
      </>
    ),
    summary: (
      <>
        <p className="screen-lead">AI가 쓴 설명입니다. 판례 화면의 기록과 성격이 다릅니다.</p>
        <AiSummaryPanel state={state} />
        <WebCasesPanel state={webCasesState} />
      </>
    ),
  };

  return (
    <div className="result-deck" ref={deckRef} onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="deck-progress" aria-hidden="true">
        {RESULT_SCREENS.map((screen, position) => (
          <span key={screen.id} className={`deck-dot ${position === index ? "is-active" : ""} ${position < index ? "is-done" : ""}`} />
        ))}
      </div>

      <div className="deck-stage">
      <div className="deck-nav" aria-hidden={false}>
        {previous ? (
          <button
            type="button"
            className="deck-arrow is-previous"
            onClick={() => go(index - 1)}
            aria-label={`이전 화면: ${previous.title}`}
          >
            <span aria-hidden="true" className="deck-arrow-mark">←</span>
            <span className="deck-arrow-label">{previous.title}</span>
          </button>
        ) : <span />}
        {next ? (
          <button
            type="button"
            className="deck-arrow is-next"
            onClick={() => go(index + 1)}
            aria-label={`다음 화면: ${next.title}`}
          >
            <span className="deck-arrow-label">{next.title}</span>
            <span aria-hidden="true" className="deck-arrow-mark">→</span>
            {next.generated && state.loading && <span className="deck-arrow-spinner" aria-hidden="true" />}
          </button>
        ) : <span />}
      </div>

        {RESULT_SCREENS.map((screen, position) => (
          <section
            key={screen.id}
            className={`deck-screen ${position === index ? `is-active slide-${direction}` : ""}`}
            hidden={position !== index}
            aria-label={screen.title}
          >
            <header className="screen-head">
              <p className="screen-step">{position + 1} / {RESULT_SCREENS.length}</p>
              <h2>
                {screen.generated && <span className="screen-ai" aria-hidden="true">AI</span>}
                {screen.title}
                {screen.id === "precedents" && resultCount > 0 && <span className="screen-count">{resultCount}건</span>}
                {screen.generated && state.loading && <span className="screen-spinner" aria-label="불러오는 중" />}
              </h2>
            </header>
            {panels[screen.id]}
          </section>
        ))}

      </div>

      <div className="deck-footer">
        <button className="new-case-button" type="button" onClick={onNewCase}>
          다른 사례 검색하기
        </button>
        <p>지금 입력한 내용과 결과는 지워집니다.</p>
      </div>
    </div>
  );
}


function ResultsView({ description, results, coverage, searchFailed, onRetry, onRevise, onNewCase, resultsStartRef, analysisState, webCasesState }) {
  const [showAll, setShowAll] = useState(false);
  const facts = useMemo(() => extractCaseFacts(description), [description]);
  const visibleResults = showAll ? results : results.slice(0, 3);
  const tags = [
    FACT_LABELS.medium[facts.medium],
    FACT_LABELS.relationship[facts.relationship],
    FACT_LABELS.context[facts.context],
    FACT_LABELS.messageForm[facts.messageForm],
    FACT_LABELS.repetition[facts.repetition],
  ].filter(Boolean);

  return (
    <section className="results-view" ref={resultsStartRef}>
      <div className="results-header">
        <button className="back-button" type="button" onClick={onRevise}><span aria-hidden="true">←</span> 입력으로 돌아가기</button>
        {/*
          A failed search compared nothing. The heading used to announce
          "사실관계가 닮은 판례" over an error panel, above chips the browser had
          read out of the description — so a page that had reached no server at
          all still displayed 게임 채팅 and 반복 as if something had been found.
        */}
        {!searchFailed && (
          <div className="results-title-row">
            <div>
              <p className="eyebrow">비교 결과</p>
              <h1>{results.length === 0 ? "닮은 판례를 찾지 못했습니다" : "사실관계가 닮은 판례"}</h1>
              <div className="fact-chips">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            </div>
            <button className="print-button" type="button" onClick={() => window.print()} aria-label="결과 저장">
              <span aria-hidden="true">⇩</span>
              <span className="print-button-label">결과 저장</span>
            </button>
          </div>
        )}
      </div>

      {!searchFailed && (
        <>
          <div className="legal-notice" role="note">
            <span aria-hidden="true">!</span>
            <div><strong>이 결과는 법적 판단이나 결과 예측이 아닙니다.</strong><p>숫자는 공개 판례와의 사실관계 유사도이며, 법적 결론이나 형량을 의미하지 않습니다.</p></div>
          </div>
          <Coverage resultCount={results.length} coverage={coverage} />
        </>
      )}

      {searchFailed ? <ErrorResults onRetry={onRetry} /> : (
        <ResultDeck
          precedents={(
            results.length === 0
              ? <EmptyResults onRevise={onRevise} availableCount={coverage.availableCount} />
              : (
                <div className="results-list">
                  {visibleResults.map((result, index) => <PrecedentCard result={result} rank={index + 1} key={result.id} />)}
                  {!showAll && results.length > 3 && (
                    <button className="show-more" type="button" onClick={() => setShowAll(true)}>
                      판례 {results.length - 3}건 더 보기 <span aria-hidden="true">↓</span>
                    </button>
                  )}
                </div>
              )
          )}
          resultCount={results.length}
          analysisState={analysisState}
          webCasesState={webCasesState}
          onNewCase={onNewCase}
        />
      )}
    </section>
  );
}

export function App() {
  const [view, setView] = useState("home");
  const [caseKey, setCaseKey] = useState(0);
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [allowExternalAi, setAllowExternalEmbedding] = useState(false);
  const [results, setResults] = useState([]);
  const [coverage, setCoverage] = useState({ availableCount: null, comparedCount: 0, scoring: null });
  const [searchFailed, setSearchFailed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [intake, setIntake] = useState({ sessionId: null, questions: [] });
  const [submittedDescription, setSubmittedDescription] = useState("");
  const [analysisState, setAnalysisState] = useState(null);
  const [webCasesState, setWebCases] = useState(null);
  // Identifies the analysis the screen is waiting for, so a reply that arrives
  // after the user moved on is discarded instead of rendered.
  const analysisTokenRef = useRef(0);
  const homeStartRef = useRef(null);
  const resultsStartRef = useRef(null);
  // The live session id, mirrored outside React state so the leave-the-page
  // handler can read it without resubscribing on every change.
  const activeSessionRef = useRef(null);
  // Kept so a retry can rebuild an equivalent session after the server deleted
  // the failed one.
  const answersRef = useRef({});

  function trackIntake(next) {
    activeSessionRef.current = next.sessionId;
    setIntake(next);
  }

  /** Stop tracking the session first, then tell the server once. */
  function releaseIntake() {
    const sessionId = activeSessionRef.current;
    activeSessionRef.current = null;
    setIntake({ sessionId: null, questions: [] });
    if (sessionId) cancelIntake({ sessionId }).catch(() => {});
  }

  useEffect(() => {
    if (view !== "results" || !resultsStartRef.current) return;
    resultsStartRef.current.scrollIntoView({ behavior: motionBehavior(), block: "start" });
  }, [view]);

  // A closing tab never runs React cleanup, so an abandoned session needs both
  // paths covered. Without this the redacted text waits for the 1-hour purge.
  useEffect(() => {
    function abandon() {
      const sessionId = activeSessionRef.current;
      if (!sessionId) return;
      activeSessionRef.current = null;
      abandonIntake({ sessionId });
    }
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      abandon();
    };
  }, []);

  function goHome() {
    setView("home");
    setResults([]);
    setSearchFailed(false);
    window.requestAnimationFrame(() => {
      homeStartRef.current?.scrollIntoView({ behavior: motionBehavior(), block: "start" });
    });
  }

  function startNewCase() {
    releaseIntake();
    answersRef.current = {};
    setRole("");
    setDescription("");
    setSubmittedDescription("");
    setAnalysisState(null);
    setWebCases(null);
    analysisTokenRef.current += 1;
    setAllowExternalEmbedding(false);
    // Remount the composer so the capture, its transcript and any answers go with it.
    setCaseKey((key) => key + 1);
    goHome();
  }

  async function requestAnalysis({ redactedText, precedents }) {
    const token = ++analysisTokenRef.current;
    setAnalysisState({ loading: true, statute: null, elements: [], analysis: null, unavailable: null });
    setWebCases({ loading: true, webCases: [], fetchedAt: null, unavailable: null });

    // A cache read, so it lands with the precedent cards rather than behind the
    // model. Deliberately not awaited together with the analysis.
    fetchWebCases({ redactedText, role, allowExternalAi }).then((found) => {
      if (token !== analysisTokenRef.current) return;
      setWebCases({ loading: false, ...found });
    });
    const next = await analyseCase({ redactedText, precedents, allowExternalAi });
    // A new case may have started while this was in flight.
    if (token !== analysisTokenRef.current) return;
    setAnalysisState({ loading: false, ...next });
  }

  // The redacted text travels as an argument rather than being read from state:
  // startIntake sets it and calls straight through, so the state this closure
  // captured is still the previous render's empty string.
  async function finishIntake(sessionId, redactedText = submittedDescription) {
    setAnalyzing(true);
    setSearchFailed(false);
    // The server deletes the session whether the search succeeds or fails, so
    // stop tracking it now. Holding the id is what made retry always 404.
    activeSessionRef.current = null;
    setIntake({ sessionId: null, questions: [] });
    try {
      const response = await completeIntake({ sessionId, allowExternalAi });
      setResults(response.results);
      setCoverage({
        availableCount: response.availableCount,
        comparedCount: response.comparedCount,
        scoring: response.scoring,
      });
      setView("results");
      // Deliberately not awaited: the cards are ready now and the statute
      // reading takes about ten seconds to come back.
      requestAnalysis({ redactedText, precedents: response.results });
    } catch {
      setResults([]);
      setCoverage({ availableCount: null, comparedCount: 0, scoring: null });
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  async function startIntake(redactedText) {
    if (analyzing) return;
    setAnalyzing(true);
    setSearchFailed(false);
    // Remember the text before calling out: a retry needs it even when the
    // very first request is what failed.
    setSubmittedDescription(redactedText);
    answersRef.current = {};
    try {
      const response = await createIntake({ role, redactedText });
      trackIntake({ sessionId: response.sessionId, questions: response.questions || [] });
      if ((response.questions || []).length === 0) await finishIntake(response.sessionId, redactedText);
    } catch {
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  async function submitAnswers(answers) {
    if (!intake.sessionId || analyzing) return;
    setAnalyzing(true);
    answersRef.current = answers;
    try {
      await answerIntake({ sessionId: intake.sessionId, answers });
      await finishIntake(intake.sessionId);
    } catch {
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  /**
   * A failed search takes its session with it, by design. Retrying therefore
   * builds a fresh session from the redacted text still held in the browser
   * rather than reusing an id the server has already deleted.
   */
  async function retrySearch() {
    if (analyzing || !role || !submittedDescription) return;
    setAnalyzing(true);
    setSearchFailed(false);
    try {
      const session = await createIntake({ role, redactedText: submittedDescription });
      const questions = session.questions || [];
      if (questions.length === 0) {
        await finishIntake(session.sessionId, submittedDescription);
        return;
      }

      const answers = {};
      for (const question of questions) {
        const stored = String(answersRef.current[question.id] || "").trim();
        if (stored) answers[question.id] = stored;
      }
      // The server requires every asked answer, so ask again rather than fail.
      if (questions.some((question) => !answers[question.id])) {
        trackIntake({ sessionId: session.sessionId, questions });
        goHome();
        return;
      }

      await answerIntake({ sessionId: session.sessionId, answers });
      await finishIntake(session.sessionId, submittedDescription);
    } catch {
      setSearchFailed(true);
      setView("results");
    } finally {
      setAnalyzing(false);
    }
  }

  function cancelCurrentIntake() {
    releaseIntake();
  }

  return (
    <div className="page-background">
      <div className={`app-shell ${view === "home" ? "is-home" : "has-results"}`}>
        <SideNavigation view={view} onNewCase={startNewCase} />
        <div className="app-content">
          <TopBar onNewCase={startNewCase} availableCount={coverage.availableCount} />
          <main className="main-content">
            <HomeView
              key={caseKey}
              role={role}
              setRole={setRole}
              description={description}
              setDescription={setDescription}
              onSubmit={startIntake}
              analyzing={analyzing}
              allowExternalAi={allowExternalAi}
              setAllowExternalEmbedding={setAllowExternalEmbedding}
              intake={intake}
              onStartIntake={startIntake}
              onSubmitAnswers={submitAnswers}
              onCancelIntake={cancelCurrentIntake}
              homeStartRef={homeStartRef}
            />
            <OfflineBadge shown={analysisState?.fixture === true || webCasesState?.fixture === true} />
            {view === "results" && (
              <ResultsView
                description={submittedDescription}
                results={results}
                coverage={coverage}
                searchFailed={searchFailed}
                onRetry={retrySearch}
                onRevise={goHome}
                onNewCase={startNewCase}
                resultsStartRef={resultsStartRef}
                analysisState={analysisState}
                webCasesState={webCasesState}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
