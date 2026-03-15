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
  const response = await fetch(`https://graph.facebook.com/v18.0/${id}?access_token=${accessToken}`, {
    method: 'DELETE',
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Facebook Delete Failed: ${data.error?.message || 'Unknown error'}`);
  }
}

async function deleteFromInstagram(id: string, accessToken: string) {
  // Instagram media deletion is restricted for many app types.
  const response = await fetch(`https://graph.facebook.com/v18.0/${id}?access_token=${accessToken}`, {
    method: 'DELETE',
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Instagram Delete Failed: ${data.error?.message || 'Instagram API does not support deletion for this content type via 3rd party apps.'}`);
  }
}
