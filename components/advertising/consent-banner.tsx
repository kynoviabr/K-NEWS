"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const CONSENT_COOKIE = "kn_consent";
const VISITOR_COOKIE = "kn_vid";
const MAX_AGE = 60 * 60 * 24 * 180;

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function writeCookie(name: string, value: string): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

// Consentimento para anuncios personalizados/medicao (LGPD). Recusar mantem
// anuncios diretos sem identificador de visitante e sem scripts de terceiros.
export function ConsentBanner() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readCookie(CONSENT_COOKIE) === null);
  }, []);

  if (!open) return null;

  const decide = (granted: boolean) => {
    writeCookie(CONSENT_COOKIE, granted ? "ads=granted" : "ads=denied");
    if (granted && !readCookie(VISITOR_COOKIE)) writeCookie(VISITOR_COOKIE, crypto.randomUUID());
    if (!granted) document.cookie = `${VISITOR_COOKIE}=; Max-Age=0; Path=/`;
    setOpen(false);
    router.refresh();
  };

  return (
    <div role="dialog" aria-live="polite" aria-label="Privacidade e anúncios" className="fixed inset-x-0 bottom-0 z-50 border-t bg-card p-4 shadow-lg">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Usamos um identificador anônimo para limitar a repetição de anúncios e medir a audiência, e parceiros de publicidade podem usar cookies. Você pode recusar sem perder acesso às notícias.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => decide(false)}>Recusar</Button>
          <Button size="sm" onClick={() => decide(true)}>Aceitar</Button>
        </div>
      </div>
    </div>
  );
}
