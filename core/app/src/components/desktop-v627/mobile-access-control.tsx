"use client";

import { ExternalLink, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  address?: string;
  available: boolean;
};

const unavailableMessage = "远程访问暂不可用，请在连接处配置公网域名后即可访问";

export function MobileAccessControl({ address, available }: Props) {
  const mobileUrl = available ? buildMobileShellUrl(address) : "";
  const [qrImage, setQrImage] = useState("");

  useEffect(() => {
    let active = true;
    setQrImage("");
    if (!mobileUrl) return () => { active = false; };
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(mobileUrl, { width: 184, margin: 1, errorCorrectionLevel: "M" }))
      .then((image) => { if (active) setQrImage(image); })
      .catch(() => { if (active) setQrImage(""); });
    return () => { active = false; };
  }, [mobileUrl]);

  return <div className={`v72-mobile-access${mobileUrl ? "" : " unavailable"}`}>
    {mobileUrl ? <a className="v72-mobile-access-trigger" href={mobileUrl} target="_blank" rel="noreferrer" aria-describedby="mobile-access-popover"><Smartphone />访问移动端<ExternalLink /></a>
      : <span className="v72-mobile-access-trigger" tabIndex={0} aria-describedby="mobile-access-popover"><Smartphone />访问移动端</span>}
    <div className="v72-mobile-access-popover" id="mobile-access-popover" role="tooltip">
      {mobileUrl ? <>{qrImage ? <img src={qrImage} alt="移动端访问二维码" /> : <span className="v72-mobile-access-qr-loading">正在生成二维码…</span>}<strong>手机扫码访问</strong><small>{mobileUrl}</small></>
        : <p>{unavailableMessage}</p>}
    </div>
  </div>;
}

export function buildMobileShellUrl(address?: string) {
  if (!address) return "";
  try {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol)) return "";
    url.pathname = "/app/mobile";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
