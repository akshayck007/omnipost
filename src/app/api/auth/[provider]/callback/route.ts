import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const rawAppUrl = process.env.APP_URL || '';
  const appUrl = rawAppUrl.replace(/\/$/, '');

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  let tokens = {};

  try {
    if (provider === 'google') {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: `${appUrl}/api/auth/google/callback`,
          grant_type: 'authorization_code',
        }),
      });
      tokens = await response.json();

      // Fetch YouTube Channel Info
      try {
        const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
          headers: { Authorization: `Bearer ${(tokens as any).access_token}` }
        });
        const channelData = await channelRes.json();
        if (channelData.items?.[0]) {
          (tokens as any).accountName = channelData.items[0].snippet.title;
          (tokens as any).profilePicture = channelData.items[0].snippet.thumbnails?.default?.url;
        }
      } catch (err) {
        console.error('Error fetching YouTube channel info:', err);
      }

    } else if (provider === 'meta') {
      const metaResponse = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${process.env.META_CLIENT_ID}&redirect_uri=${appUrl}/api/auth/meta/callback&client_secret=${process.env.META_CLIENT_SECRET}&code=${code}`);
      const tokensData = await metaResponse.json() as any;
      tokens = tokensData;
      
      if (tokensData.error) {
        console.error('Meta Token Error:', tokensData.error);
        throw new Error(tokensData.error.message || 'Meta token exchange failed');
      }

      // Fetch Meta Pages and Instagram Info
      try {
        const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${tokensData.access_token}`);
        const pagesData = await pagesRes.json();
        
        if (pagesData.error) {
          console.error('Error fetching pages:', pagesData.error);
        }

        if (pagesData.data) {
          (tokens as any).pages = pagesData.data.map((p: any) => ({ id: p.id, name: p.name }));
          
          // Try to find Instagram accounts for these pages
          const igAccounts = [];
          // Check up to 10 pages to find linked Instagram accounts
          for (const page of pagesData.data.slice(0, 10)) {
            try {
              const igRes = await fetch(`https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account{id,username,name}&access_token=${page.access_token}`);
              const igData = await igRes.json();
              
              if (igData.instagram_business_account) {
                // Avoid duplicates
                if (!igAccounts.some(acc => acc.id === igData.instagram_business_account.id)) {
                  igAccounts.push({
                    id: igData.instagram_business_account.id,
                    username: igData.instagram_business_account.username,
                    name: igData.instagram_business_account.name || igData.instagram_business_account.username
                  });
                }
              }
            } catch (igErr) {
              console.error(`Error checking IG for page ${page.id}:`, igErr);
            }
          }
          (tokens as any).instagramAccounts = igAccounts;
          console.log(`Found ${igAccounts.length} Instagram accounts and ${pagesData.data.length} Pages.`);
        } else {
          console.log('No pages found for this user.');
          (tokens as any).pages = [];
          (tokens as any).instagramAccounts = [];
        }
      } catch (err) {
        console.error('Error fetching Meta account info:', err);
      }
    }

    const html = `
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: '${provider}', tokens: ${JSON.stringify(tokens)} }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful! You can close this window.</p>
        </body>
      </html>
    `;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error(`${provider} Auth Error:`, error);
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
