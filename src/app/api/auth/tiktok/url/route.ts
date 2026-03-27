import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const appUrl = process.env.APP_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const redirectUri = `${appUrl}/api/auth/tiktok/callback`;

  if (!clientKey) {
    return NextResponse.json({ error: 'TikTok Client Key not configured' }, { status: 500 });
  }

  // TikTok V2 Auth URL
  const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
  authUrl.searchParams.append('client_key', clientKey);
  authUrl.searchParams.append('scope', 'user.info.basic,video.upload,video.publish');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('state', Math.random().toString(36).substring(7));

  return NextResponse.json({ url: authUrl.toString() });
}
