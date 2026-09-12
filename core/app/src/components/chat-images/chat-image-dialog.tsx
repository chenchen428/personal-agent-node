"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, LoaderCircle, Maximize, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeChatImageUrl, type ChatPreviewImage } from "@/lib/chat-image-preview";

export function ChatImageDialog({ image, onClose }: { image: ChatPreviewImage; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState(safeChatImageUrl(image.src));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(!source);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const downloadAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const message = previous?.closest("article");
    const label = previous?.getAttribute("aria-label");
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.showModal(); closeRef.current?.focus({ preventScroll: true });
    return () => {
      downloadAbort.current?.abort(); document.body.style.overflow = oldOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      else if (message?.isConnected && label) {
        const replacement = Array.from(message.querySelectorAll<HTMLElement>("[data-chat-image], .chat-image-trigger")).find((element) => element.getAttribute("aria-label") === label);
        replacement?.focus({ preventScroll: true });
      }
    };
  }, []);
  const download = async () => {
    const url = safeChatImageUrl(image.downloadUrl || source);
    if (!url || downloading) return;
    const controller = new AbortController(); downloadAbort.current = controller;
    setDownloading(true); setDownloadError("");
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: new URL(url, location.href).origin === location.origin ? "same-origin" : "omit" });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const localUrl = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = localUrl; link.download = image.name || "图片";
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
    } catch { if (!controller.signal.aborted) setDownloadError("下载失败，请重试。"); }
    finally { if (!controller.signal.aborted) setDownloading(false); }
  };
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialogRef} className="chat-image-dialog" aria-label={`图片预览：${image.alt}`} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="chat-image-toolbar">
      <strong>{image.name || image.alt || "图片预览"}</strong>
      <div>
        <Button variant="ghost" size="icon" disabled={failed || loading || zoom <= 1} aria-label="缩小图片" onClick={() => setZoom((value) => Math.max(1, value - .5))}><Minus /></Button>
        <Button variant="ghost" size="icon" disabled={failed || loading || zoom >= 3} aria-label="放大图片" onClick={() => setZoom((value) => Math.min(3, value + .5))}><Plus /></Button>
        <Button variant="ghost" size="icon" disabled={failed || loading} aria-label="适应窗口" onClick={() => setZoom(1)}><Maximize /></Button>
        <Button variant="ghost" size="icon" disabled={failed || downloading} aria-label={downloading ? "正在下载图片" : "下载图片"} onClick={() => void download()}>{downloading ? <LoaderCircle className="chat-image-spinning" /> : <Download />}</Button>
        <Button ref={closeRef} variant="ghost" size="icon" aria-label="关闭图片预览" onClick={onClose}><X /></Button>
      </div>
    </header>
    <div className="chat-image-stage">
      {loading && !failed ? <p className="chat-image-notice" role="status">正在加载图片…</p> : null}
      {failed ? <div className="chat-image-notice" role="alert"><p>图片暂时无法加载。</p><Button variant="outline" size="sm" disabled={!source} onClick={() => { setFailed(false); setLoading(true); setAttempt((value) => value + 1); }}>重试</Button></div> : source ? <div className="chat-image-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
        <img key={attempt} src={source} alt={image.alt} draggable={false} onLoad={() => setLoading(false)} onError={() => {
          const fallback = safeChatImageUrl(image.fallbackSrc || "");
          if (fallback && source !== fallback) { setSource(fallback); return; }
          setLoading(false); setFailed(true);
        }} />
      </div> : null}
    </div>
    {downloadError ? <p className="chat-image-download-error" role="alert">{downloadError}</p> : null}
  </dialog>, document.body);
}
