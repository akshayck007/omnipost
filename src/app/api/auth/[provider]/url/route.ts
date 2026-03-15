import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const rawAppUrl = process.env.APP_URL || '';
  const appUrl = rawAppUrl.replace(/\/$/, '');

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = `${appUrl}/api/auth/google/callback`;
    const scopes = [
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/userinfo.profile",
    ].join(' ');

    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent`;
    return NextResponse.json({ url });
  }

  if (provider === 'meta') {
    const clientId = process.env.META_CLIENT_ID;
    const redirectUri = `${appUrl}/api/auth/meta/callback`;
    const scopes = [
      "public_profile",
      "email",
      "instagram_basic",
      "instagram_content_publish",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "pages_read_user_content",
      "business_management"
    ].join(',');
    
    const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scopes)}`;
    return NextResponse.json({ url });
  }

  return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
}
