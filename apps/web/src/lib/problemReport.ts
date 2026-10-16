const FEEDBACK_EMAIL = "support@peakhorology.com";

type ReportApi = {
  note: (message: string) => void;
  open: () => Promise<unknown>;
  feedback: () => Promise<unknown>;
  text?: () => Promise<string>;
};

export function problemReportApi(): ReportApi | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { peakcadReport?: ReportApi }).peakcadReport ?? null;
}

export function rememberProblem(message: string) {
  const text = message.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) return;
  problemReportApi()?.note(text);
}

export async function savedProblemReport() {
  const text = await problemReportApi()?.text?.();
  return typeof text === "string" ? text : "";
}

function mailDraft(subject: string, body: string) {
  const contents = [
    `To: ${FEEDBACK_EMAIL}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=\"utf-8\"",
    "Content-Transfer-Encoding: 8bit",
    "X-Unsent: 1",
    "",
    body,
  ].join("\r\n");
  const blob = new Blob([contents], { type: "message/rfc822" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = subject.toLowerCase().includes("problem") ? "PeakCAD-problem.eml" : "PeakCAD-feedback.eml";
  link.click();
  URL.revokeObjectURL(url);
}

export async function openFeedback(version: string) {
  const api = problemReportApi();
  if (api?.feedback) {
    await api.feedback();
    return;
  }
  const body = [
    `PeakCAD ${version || "browser"}`,
    "",
    "We'd love to hear what you think.",
    "",
    "",
    "Your design is not included. Attach a project file only if you want it looked at.",
  ].join("\n");
  mailDraft("PeakCAD feedback", body);
}

export async function openProblemReport(version: string) {
  const api = problemReportApi();
  if (api) {
    await api.open();
    return;
  }
  const body = [
    `PeakCAD ${version || "browser"}`,
    "",
    "What were you doing when this happened?",
    "",
    "",
    "Your design is not included. Attach a project file only if you want it looked at.",
    "",
    `Browser: ${typeof navigator === "undefined" ? "" : navigator.userAgent}`,
  ].join("\n");
  mailDraft("PeakCAD problem report", body);
}
