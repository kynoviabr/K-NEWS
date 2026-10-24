"use client";

import { useEffect, useRef } from "react";

// Confirma a impressao quando ao menos metade do anuncio fica visivel por 1s
// (criterio de visibilidade do IAB/MRC). Uma vez por reserva.
export function ImpressionBeacon({ token }: { token: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const target = ref.current?.parentElement;
    if (!target || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      const body = JSON.stringify({ token });
      if (!navigator.sendBeacon?.("/api/ads/impression", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/ads/impression", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
      }
      observer.disconnect();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
          timer ??= setTimeout(send, 1000);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(target);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [token]);

  return <span ref={ref} hidden />;
}
