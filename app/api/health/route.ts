import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "k-news",
    version: "0.1.0-fase0",
    timestamp: new Date().toISOString(),
  });
}
