import { NextResponse } from 'next/server'

export async function GET() {
  const response = NextResponse.redirect(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/`)
  response.cookies.delete('gcal_token')
  return response
}
