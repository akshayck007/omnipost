import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { videoId, platformResults, tokens } = await request.json();

    console.log('Delete Request:', {
      videoId,
      platforms: platformResults.map((r: any) => r.platform),
      hasTokens: !!tokens
    });

    const results = [];

    for (const res of platformResults) {
      if (res.status !== 'success') continue;

      try {
        if (res.platform === 'youtube' && tokens.youtube) {
          await deleteFromYouTube(res.id, tokens.youtube.access_token);
          results.push({ platform: 'youtube', status: 'success' });
        } else if (res.platform === 'facebook' && tokens.meta) {
          await deleteFromFacebook(res.id, tokens.meta.access_token);
          results.push({ platform: 'facebook', status: 'success' });
        } else if (res.platform === 'instagram' && tokens.meta) {
          // Instagram API often doesn't support deletion for 3rd party apps, 
          // but we'll try the standard media delete endpoint.
          await deleteFromInstagram(res.id, tokens.meta.access_token);
          results.push({ platform: 'instagram', status: 'success' });
        } else if (res.platform === 'tiktok') {
          // TikTok API does not support media deletion for 3rd party apps
          results.push({ platform: 'tiktok', status: 'error', message: 'TikTok platform limitation: Deleting videos via 3rd party apps is not supported by the TikTok API. Please delete this post directly from the TikTok app.' });
        }
      } catch (err: any) {
        console.error(`Delete failed for ${res.platform}:`, err);
        results.push({ platform: res.platform, status: 'error', message: err.message });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Global Delete Error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}

async function deleteFromYouTube(id: string, accessToken: string) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(`YouTube Delete Failed: ${JSON.stringify(error)}`);
  }
}

async function deleteFromFacebook(id: string, accessToken: string) {
  // We need the page access token to delete. 
  // For simplicity, we'll try to find the page token again or use the user token if it has permissions.
  // Usually, the video ID itself can be deleted with the right token.
  const response = await fetch(`https://graph.facebook.com/v19.0/${id}?access_token=${accessToken}`, {
    method: 'DELETE',
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Facebook Delete Failed: ${data.error?.message || 'Unknown error'}`);
  }
}

async function deleteFromInstagram(id: string, accessToken: string) {
  // Instagram Content Publishing API officially does NOT support media deletion via 3rd party apps.
  // We attempt it as a courtesy, but it usually fails with (#10) Insufficient permissions.
  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${id}?access_token=${accessToken}`, {
      method: 'DELETE',
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      const msg = data.error?.message || '';
      if (msg.includes('permissions') || data.error?.code === 10 || data.error?.code === 200) {
        throw new Error('Instagram platform limitation: Deleting Reels via 3rd party apps is not supported by the Instagram API. Please delete this post directly from the Instagram app.');
      }
      throw new Error(`Instagram Delete Failed: ${msg || 'Platform restriction'}`);
    }
  } catch (err: any) {
    if (err.message.includes('Instagram platform limitation')) throw err;
    throw new Error(`Instagram Delete Failed: ${err.message}`);
  }
}
