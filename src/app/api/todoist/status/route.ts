import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.TODOIST_API_TOKEN) })
}
