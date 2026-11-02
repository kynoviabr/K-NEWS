"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const SCRIPTS: Record<"adsense" | "mgid", (publisherId: string) => string> = {
  adsense: (id) => `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(id)}`,
  mgid: (id) => `https://jsc.mgid.com/site/${encodeURIComponent(id)}.js`,
};

function loadScriptOnce(src: string): void {
  if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) return;
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
}

// Slot programatico. So e renderizado quando o provedor foi aprovado e ligado no
// portal e o visitante consentiu com anuncios (o servidor confere as duas coisas).
export function ProviderSlot({ provider, publisherId, providerSlotId }: { provider: "adsense" | "mgid"; publisherId: string; providerSlotId: string | null }) {
  const pushed = useRef(false);

  useEffect(() => {
    if (!providerSlotId) return;
    loadScriptOnce(SCRIPTS[provider](publisherId));
    if (provider === "adsense" && !pushed.current) {
      pushed.current = true;
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    }
  }, [provider, publisherId, providerSlotId]);

  if (!providerSlotId) return null;
  if (provider === "adsense") {
    return <ins className="adsbygoogle block" data-ad-client={publisherId} data-ad-slot={providerSlotId} data-ad-format="auto" data-full-width-responsive="true" />;
  }
  return <div data-type="_mgwidget" data-widget-id={providerSlotId} />;
}
