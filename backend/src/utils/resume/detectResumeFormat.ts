export type SupportedResumeFormat = "pdf" | "pptx";

/**
 * Node's only involvement with resume "parsing" is knowing which format
 * to tell the agent service it's sending — actual text/content extraction
 * (PyMuPDF/python-pptx, plus the vision fallback) lives entirely in
 * the `agent` service now.
 */
export function detectResumeFormat(filename: string): SupportedResumeFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "pptx") return "pptx";
  throw new Error(`Unsupported resume file format: .${ext}`);
}
