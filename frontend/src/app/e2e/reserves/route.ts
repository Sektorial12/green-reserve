import { NextResponse } from "next/server";

export function GET(request: Request) {
  if (process.env.E2E_TEST !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const scenario = url.searchParams.get("scenario") ?? "default";

  return NextResponse.json({
    asOfTimestamp: 0,
    scenario,
    totalReservesUsd: "100",
    totalLiabilitiesUsd: "100",
    reserveRatioBps: "10000",
    proofRef: "e2e",
  });
}
