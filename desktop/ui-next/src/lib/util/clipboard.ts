// 异步剪贴板失败后回退 execCommand；返回实际结果供代码块反馈使用。
export async function copyTextResult(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 继续使用旧 WebView 剪贴板路径 */ }
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand("copy");
  } catch { return false; }
  finally { textarea.remove(); if (previous?.isConnected) previous.focus(); }
}

export function copyText(text: string): void { void copyTextResult(text); }
