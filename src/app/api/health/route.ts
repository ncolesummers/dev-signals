import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";

/**
 * Health check endpoint
 * Returns 200 OK if the application is running
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "DevSignals",
      version: packageJson.version,
    },
    { status: 200 },
  );
}
