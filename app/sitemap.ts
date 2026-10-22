import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://knews.example.com";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/noticias`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/localidades`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
  ];
}
