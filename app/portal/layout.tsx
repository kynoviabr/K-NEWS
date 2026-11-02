import { ConsentBanner } from "@/components/advertising/consent-banner";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ConsentBanner />
    </>
  );
}
