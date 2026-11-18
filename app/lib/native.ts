// This origin is served only by the bundled Android WebView.
export function inSesasiApp() {
  return typeof window !== "undefined" && window.location.origin === "https://appassets.androidplatform.net";
}

type BackupBridge = {
  beginBackup(filename: string): boolean;
  appendBackup(chunk: string): boolean;
  finishBackup(): void;
  cancelBackup(): void;
};

declare global {
  interface Window {
    SesasiFiles?: BackupBridge;
  }
}

export async function saveBackup(contents: string, filename: string): Promise<boolean> {
  const bridge = inSesasiApp() ? window.SesasiFiles : undefined;
  if (!bridge) {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  if (!bridge.beginBackup(filename)) throw new Error("이미 백업을 저장 중이거나 기기 저장 공간이 부족해요.");
  try {
    // Send large image backups in chunks to avoid one oversized bridge message.
    for (let offset = 0; offset < contents.length; offset += 262144) {
      if (!bridge.appendBackup(contents.slice(offset, offset + 262144))) throw new Error("백업 파일을 준비하지 못했어요.");
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return await new Promise<boolean>((resolve, reject) => {
      const complete = (event: Event) => {
        window.removeEventListener("sesasi-backup-result", complete);
        const status = (event as CustomEvent<string>).detail;
        if (status === "error") reject(new Error("백업 파일을 저장하지 못했어요."));
        else resolve(status === "saved");
      };
      window.addEventListener("sesasi-backup-result", complete);
      try { bridge.finishBackup(); }
      catch (error) {
        window.removeEventListener("sesasi-backup-result", complete);
        reject(error);
      }
    });
  } catch (error) {
    bridge.cancelBackup();
    throw error;
  }
}
