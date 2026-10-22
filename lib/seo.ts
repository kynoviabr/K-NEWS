type NewsArticleJsonLd = {
  "@context": string;
  "@type": string;
  headline: string;
  description?: string;
  datePublished?: string;
  dateModified?: string;
  author?: { "@type": string; name: string };
  publisher?: { "@type": string; name: string; logo?: { "@type": string; url: string } };
  mainEntityOfPage?: string;
};

export function newsArticleJsonLd(params: {
  headline: string;
  description?: string;
  datePublished?: string;
  dateModified?: string;
  url?: string;
  authorName?: string;
  publisherName?: string;
}): NewsArticleJsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: params.headline,
    description: params.description,
    datePublished: params.datePublished,
    dateModified: params.dateModified,
    mainEntityOfPage: params.url,
    author: params.authorName ? { "@type": "Person", name: params.authorName } : undefined,
    publisher: params.publisherName ? { "@type": "Organization", name: params.publisherName } : undefined,
  };
}
