import { NextResponse } from "next/server";

export function GET(request: Request) {
  if (process.env.E2E_TEST !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";

  return NextResponse.json({
    address,
    isAllowed: true,
    reason: "allowed",
  });
}
