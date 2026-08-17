const REDACTION_PATTERNS = [
  /\b\d{6}[-\s]?\d{7}\b/g,
  /https?:\/\/[^\s,]+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /@[a-z0-9_.-]{2,}/gi,
  /(?:0\d{1,2}[-\s]?)?\d{3,4}[-\s]?\d{4}/g,
  /(?:[가-힣]+(?:로|길)\s*\d+(?:-\d+)?(?:번지)?)/g,
];

export function redactSensitiveText(value) {
  let text = String(value || "");
  let redactionCount = 0;

  for (const pattern of REDACTION_PATTERNS) {
    text = text.replace(pattern, () => {
      redactionCount += 1;
      return "[가림]";
    });
  }

  return { text, redactionCount };
}
