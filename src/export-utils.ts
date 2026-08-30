export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") {
    throw new Error("Blob downloads require a browser document.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);

  try {
    link.click();
  } finally {
    link.remove();
    // Revoking synchronously can cancel a download in some browsers.
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}
