import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type ArticleCardProps = {
  slug: string;
  title: string;
  excerpt?: string | null;
  category?: string | null;
  publishedAt?: string | null;
  hrefPrefix?: string;
};

export function ArticleCard({ slug, title, excerpt, category, publishedAt, hrefPrefix = "/noticias" }: ArticleCardProps) {
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="space-y-2">
        <div className="flex items-center gap-2">
          {category && <Badge>{category}</Badge>}
          {publishedAt && <span className="text-xs text-muted-foreground">{new Date(publishedAt).toLocaleDateString("pt-BR")}</span>}
        </div>
        <CardTitle className="line-clamp-2 text-base">
          <Link href={`${hrefPrefix}/${slug}`} className="hover:underline">
            {title}
          </Link>
        </CardTitle>
        {excerpt && <CardDescription className="line-clamp-2">{excerpt}</CardDescription>}
      </CardHeader>
      <CardContent className="mt-auto pt-0">
        <Link href={`${hrefPrefix}/${slug}`} className="text-sm font-medium text-primary hover:underline">
          Ler matéria →
        </Link>
      </CardContent>
    </Card>
  );
}
