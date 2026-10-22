import { ImageResponse } from "next/og";

export const alt = "K-NEWS — Rede de Noticias Hiperlocais";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f2a3a 0%, #0e6b7a 100%)",
          color: "white",
          fontSize: 64,
          fontWeight: 700,
        }}
      >
        K-NEWS — Rede Kynovia
      </div>
    ),
    size
  );
}
