import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { hashtag, instagramAccountId, accessToken } = await request.json();

    if (!hashtag || !instagramAccountId || !accessToken) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 1. Search for the hashtag ID
    const searchRes = await fetch(
      `https://graph.facebook.com/v19.0/ig_hashtag_search?user_id=${instagramAccountId}&q=${encodeURIComponent(hashtag.replace('#', ''))}&access_token=${accessToken}`
    );
    const searchData = await searchRes.json();

    if (searchData.error) {
      console.error('Instagram Hashtag Search Error:', searchData.error);
      return NextResponse.json({ error: searchData.error.message }, { status: 400 });
    }

    if (!searchData.data || searchData.data.length === 0) {
      return NextResponse.json({ error: 'Hashtag not found' }, { status: 404 });
    }

    const hashtagId = searchData.data[0].id;

    // 2. Get the hashtag info. We MUST pass user_id as a query param to see media_count
    // We use v19.0 which is the latest stable
    const infoRes = await fetch(
      `https://graph.facebook.com/v19.0/${hashtagId}?fields=id,name,media_count&user_id=${instagramAccountId}&access_token=${accessToken}`
    );
    let infoData = await infoRes.json();

    // If we get an error about the field not existing, it's likely a permission or API version quirk
    if (infoData.error) {
      console.log('Primary info fetch failed, trying fallback...', infoData.error.message);
      const fallbackRes = await fetch(
        `https://graph.facebook.com/v19.0/${hashtagId}?fields=id,name&access_token=${accessToken}`
      );
      infoData = await fallbackRes.json();
      
      if (infoData.error) {
        return NextResponse.json({ error: infoData.error.message }, { status: 400 });
      }
    }

    // If media_count is still missing/0, it might be restricted by Instagram for this app
    // We'll return what we have.
    return NextResponse.json({
      id: infoData.id,
      name: infoData.name,
      media_count: infoData.media_count || 0,
      is_restricted: !infoData.media_count
    });

  } catch (error: any) {
    console.error('Hashtag API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
