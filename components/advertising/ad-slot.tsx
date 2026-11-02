import { decideAd } from "@/lib/ads/serve";
import { cn } from "@/lib/utils";
import { ImpressionBeacon } from "./impression-beacon";
import { ProviderSlot } from "./provider-slot";

export type AdSlotProps = {
  portalId: string;
  slotCode: string;
  category?: string | null;
  neighborhood?: string | null;
  className?: string;
};

// Slot publicitario resolvido a cada requisicao pelo motor (knews.serve_ad).
// Sem campanha elegivel nem provedor aprovado, nao renderiza nada.
export async function AdSlot({ portalId, slotCode, category, neighborhood, className }: AdSlotProps) {
  const ad = await decideAd(portalId, slotCode, { category, neighborhood });
  if (ad.kind === "none") return null;

  if (ad.kind === "provider") {
    // Sem consentimento ou sem o id do bloco no provedor, nada de script de terceiros.
    if (!ad.consent || !ad.providerSlotId) return null;
    return (
      <aside aria-label="Publicidade" className={cn("mx-auto w-full", className)} data-ad-slot={slotCode}>
        <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Publicidade</p>
        <ProviderSlot provider={ad.provider} publisherId={ad.publisherId} providerSlotId={ad.providerSlotId} />
      </aside>
    );
  }

  const href = ad.creative.hasClick ? `/api/ads/click/${ad.token}` : null;
  const content =
    ad.creative.format === "image" && ad.creative.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- URL assinada e temporaria do Storage
      <img
        src={ad.creative.imageUrl}
        alt={ad.creative.altText ?? ad.label}
        width={ad.width ?? undefined}
        height={ad.height ?? undefined}
        loading="lazy"
        className="mx-auto h-auto max-w-full rounded-md"
      />
    ) : (
      <span className="block rounded-md border bg-card px-4 py-3 text-left">
        <strong className="block font-heading text-base">{ad.creative.headline}</strong>
        {ad.creative.bodyText && <span className="mt-1 block text-sm text-muted-foreground">{ad.creative.bodyText}</span>}
      </span>
    );

  return (
    <aside aria-label={ad.label} className={cn("mx-auto w-full", className)} data-ad-slot={slotCode}>
      <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{ad.label}</p>
      {href ? (
        <a href={href} target="_blank" rel="sponsored noopener" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {content}
        </a>
      ) : (
        content
      )}
      <ImpressionBeacon token={ad.token} />
    </aside>
  );
}
