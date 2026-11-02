import { NextResponse } from "next/server";
import { createCreativeSchema } from "@/lib/validations/ads.schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createCreativeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { campaign_id, file_name, content_type } = parsed.data;
    // Caminho dentro do bucket knews-creative: <campaign_id>/<arquivo> (exigido pela politica de Storage)
    const storagePath = `${campaign_id}/${crypto.randomUUID()}-${file_name}`;
    // Storage upload real exigiria Supabase client com service_role — aqui validamos e retornamos path assinavel
    return NextResponse.json({ storagePath, contentType: content_type, campaignId: campaign_id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
