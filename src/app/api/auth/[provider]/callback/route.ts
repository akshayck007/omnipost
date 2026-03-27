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
      if ((tokens as any).expires_in) {
        (tokens as any).expires_at = Date.now() + ((tokens as any).expires_in * 1000);
      }

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
      const metaResponse = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.META_CLIENT_ID}&redirect_uri=${appUrl}/api/auth/meta/callback&client_secret=${process.env.META_CLIENT_SECRET}&code=${code}`);
      const shortLivedTokens = await metaResponse.json() as any;
      
      if (shortLivedTokens.error) {
        console.error('Meta Token Error:', shortLivedTokens.error);
        throw new Error(shortLivedTokens.error.message || 'Meta token exchange failed');
      }

      // Exchange for long-lived token
      const longLivedResponse = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_CLIENT_ID}&client_secret=${process.env.META_CLIENT_SECRET}&fb_exchange_token=${shortLivedTokens.access_token}`);
      const tokensData = await longLivedResponse.json() as any;
      tokens = tokensData;
      
      if (tokensData.error) {
        console.error('Meta Long-Lived Token Error:', tokensData.error);
        // Fallback to short-lived if long-lived exchange fails for some reason
        tokens = shortLivedTokens;
      }

      // Fetch Meta Pages and Instagram Info
      try {
        const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=name,id,access_token,instagram_business_account{id,username,name}&access_token=${(tokens as any).access_token}`);
        const pagesData = await pagesRes.json();
        
        if (pagesData.error) {
          console.error('Error fetching pages:', pagesData.error);
        }
 
        // Check permissions
        const permsRes = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${tokensData.access_token}`);
        const permsData = await permsRes.json();
        const hasPublishPerm = permsData.data?.some((p: any) => p.permission === 'instagram_content_publish' && p.status === 'granted');
        (tokens as any).hasInstagramPublishPermission = hasPublishPerm;
        (tokens as any).rawPermissions = permsData.data;
 
        if (pagesData.data) {
          (tokens as any).pages = pagesData.data.map((p: any) => ({ id: p.id, name: p.name }));
          
          // Try to find Instagram accounts for these pages
          const igAccounts = [];
 
          // Strategy 1: Bulk discovery (already fetched in pagesRes)
          for (const page of pagesData.data) {
            if (page.instagram_business_account) {
              const ig = page.instagram_business_account;
              if (!igAccounts.some(acc => acc.id === ig.id)) {
                igAccounts.push({
                  id: ig.id,
                  username: ig.username || 'unknown',
                  name: ig.name || ig.username || 'Instagram Account',
                  account_type: ig.account_type || 'BUSINESS'
                });
              }
            }
          }
 
          // Strategy 2: Direct discovery (User-level)
          try {
            console.log('Trying direct Instagram discovery...');
            const directIgRes = await fetch(`https://graph.facebook.com/v19.0/me/instagram_business_accounts?access_token=${tokensData.access_token}`);
            const directIgData = await directIgRes.json();
            if (directIgData.data) {
              for (const ig of directIgData.data) {
                if (!igAccounts.some(acc => acc.id === ig.id)) {
                  console.log(`Found direct Instagram account: @${ig.username}`);
                  igAccounts.push({
                    id: ig.id,
                    username: ig.username || 'unknown',
                    name: ig.name || ig.username || 'Instagram Account',
                    account_type: ig.account_type || 'BUSINESS'
                  });
                }
              }
            }
          } catch (e) {
            console.error('Error in direct IG discovery:', e);
          }
 
          // Strategy 3: Targeted Page-level discovery (Fallback)
          // Only run if we haven't found everything or want to be super thorough
          if (igAccounts.length === 0) {
            for (const page of pagesData.data.slice(0, 15)) {
              try {
                console.log(`Checking IG for page: ${page.name} (${page.id})`);
                
                let igData: any = null;
                
                // 1. Try with Page Access Token (Most reliable)
                if (page.access_token) {
                  const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account{id,username,name},instagram_accounts{id,username,name}&access_token=${page.access_token}`);
                  igData = await igRes.json();
                }
                
                // 2. Fallback to User Access Token if Page token didn't work or was missing
                if (!igData || igData.error || (!igData.instagram_business_account && !igData.instagram_accounts)) {
                  const fallbackRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account{id,username,name},instagram_accounts{id,username,name}&access_token=${tokensData.access_token}`);
                  const fallbackData = await fallbackRes.json();
                  
                  if (fallbackData.instagram_business_account || fallbackData.instagram_accounts) {
                    igData = fallbackData;
                  } else if (!igData || igData.error) {
                    igData = fallbackData;
                  }
                }

                if (igData && !igData.error) {
                  // Handle instagram_business_account
                  if (igData.instagram_business_account) {
                    const ig = igData.instagram_business_account;
                    if (!igAccounts.some(acc => acc.id === ig.id)) {
                      igAccounts.push({
                        id: ig.id,
                        username: ig.username || 'unknown',
                        name: ig.name || ig.username || 'Instagram Account',
                        account_type: ig.account_type || 'BUSINESS'
                      });
                    }
                  }
                  
                  // Handle instagram_accounts (Legacy)
                  if (igData.instagram_accounts?.data) {
                    for (const ig of igData.instagram_accounts.data) {
                      if (!igAccounts.some(acc => acc.id === ig.id)) {
                        igAccounts.push({
                          id: ig.id,
                          username: ig.username || 'unknown',
                          name: ig.name || ig.username || 'Instagram Account',
                          account_type: 'LINKED'
                        });
                      }
                    }
                  }
                }
              } catch (igErr) {
                console.error(`Exception checking IG for page ${page.id}:`, igErr);
              }
            }
          }
          (tokens as any).instagramAccounts = igAccounts;
          console.log(`Final discovery: Found ${igAccounts.length} Instagram accounts.`);
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
