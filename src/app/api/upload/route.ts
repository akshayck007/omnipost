import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

async function refreshYouTubeToken(refreshToken: string) {
  console.log('Refreshing YouTube access token...');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  
  if (!response.ok) {
    const err = await response.json();
    console.error('YouTube Token Refresh Failed:', err);
    throw new Error('Failed to refresh YouTube access token');
  }
  
  return await response.json();
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const platforms = formData.getAll('platforms') as string[];
    const tokensRaw = formData.get('tokens') as string;
    const tokens = JSON.parse(tokensRaw || '{}');
    const optionsRaw = formData.get('options') as string;
    const options = JSON.parse(optionsRaw || '{}');
    const userId = formData.get('userId') as string;
    const video = formData.get('video') as File;

    console.log('Upload Request:', {
      title,
      platforms,
      tokenKeys: Object.keys(tokens),
      hasVideo: !!video,
      videoSize: video?.size,
      options,
      userId
    });

    if (!video) {
      return NextResponse.json({ error: 'No video file uploaded' }, { status: 400 });
    }

    const results = [];

    // 1. YouTube Upload
    if (platforms.includes('youtube')) {
      if (tokens.youtube) {
        try {
          let accessToken = tokens.youtube.access_token;
          try {
            const ytResult = await uploadToYouTube(video, title, description, accessToken, options);
            results.push({ platform: 'youtube', status: 'success', ...ytResult });
          } catch (err: any) {
            // Check if it's an auth error and we have a refresh token
            if (err.message.includes('401') && tokens.youtube.refresh_token) {
              const newTokens = await refreshYouTubeToken(tokens.youtube.refresh_token);
              accessToken = newTokens.access_token;
              
              // Update Firestore with new token
              if (userId) {
                const userDocRef = doc(db, 'users', userId);
                await updateDoc(userDocRef, {
                  [`tokens.youtube.access_token`]: accessToken,
                  [`tokens.youtube.expires_at`]: Date.now() + (newTokens.expires_in * 1000)
                });
              }

              // Retry upload
              const ytResult = await uploadToYouTube(video, title, description, accessToken, options);
              results.push({ platform: 'youtube', status: 'success', ...ytResult });
            } else {
              throw err;
            }
          }
        } catch (err: any) {
          results.push({ platform: 'youtube', status: 'error', message: err.message });
        }
      } else {
        results.push({ platform: 'youtube', status: 'error', message: 'YouTube account not connected' });
      }
    }

    // 2. Instagram Upload
    if (platforms.includes('instagram')) {
      if (tokens.meta) {
        try {
          const igResult = await uploadToMeta(video, title, description, tokens.meta.access_token, 'instagram', options);
          results.push({ platform: 'instagram', status: 'success', ...igResult });
        } catch (err: any) {
          results.push({ platform: 'instagram', status: 'error', message: err.message });
        }
      } else {
        results.push({ platform: 'instagram', status: 'error', message: 'Instagram account not connected' });
      }
    }

    // 3. Facebook Upload
    if (platforms.includes('facebook')) {
      if (tokens.meta) {
        try {
          const fbResult = await uploadToMeta(video, title, description, tokens.meta.access_token, 'facebook', options);
          results.push({ platform: 'facebook', status: 'success', ...fbResult });
        } catch (err: any) {
          results.push({ platform: 'facebook', status: 'error', message: err.message });
        }
      } else {
        results.push({ platform: 'facebook', status: 'error', message: 'Facebook account not connected' });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Global Upload Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

async function uploadToYouTube(file: File, title: string, description: string, accessToken: string, options: any = {}) {
  // Step 1: Initialize Resumable Upload
  const metadata = {
    snippet: {
      title,
      description,
      categoryId: options.category || '22', // People & Blogs
      tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
    },
    status: {
      privacyStatus: options.privacy || 'unlisted', 
      selfDeclaredMadeForKids: false,
    },
  };

  const initResponse = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': file.size.toString(),
        'X-Upload-Content-Type': file.type,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResponse.ok) {
    const error = await initResponse.json();
    throw new Error(`YouTube Init Failed: ${JSON.stringify(error)}`);
  }

  const uploadUrl = initResponse.headers.get('Location');
  if (!uploadUrl) throw new Error('YouTube upload URL not found');

  // Step 2: Upload the actual video data
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': file.size.toString(),
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error('YouTube Data Upload Failed');
  }

  const finalData = await uploadResponse.json();
  return { id: finalData.id, link: `https://youtu.be/${finalData.id}` };
}

async function uploadToMeta(file: File, title: string, description: string, accessToken: string, platform: 'facebook' | 'instagram', options: any = {}) {
  // 1. Get Pages
  console.log('Fetching Meta accounts (Pages) with token prefix:', accessToken?.substring(0, 10));
  const pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`);
  const pagesData = await pagesResponse.json();
  
  if (pagesData.error) {
    console.error('Meta API Error (me/accounts):', pagesData.error);
    throw new Error(`Meta API Error: ${pagesData.error.message} (${pagesData.error.type})`);
  }

  if (!pagesData.data || pagesData.data.length === 0) {
    throw new Error('No Facebook Pages found. You need a Facebook Page to publish content.');
  }

  // Use selected pageId or default to first
  let page = pagesData.data[0];
  if (options.pageId) {
    const foundPage = pagesData.data.find((p: any) => p.id === options.pageId);
    if (foundPage) page = foundPage;
  }
  
  const pageId = page.id;
  const pageAccessToken = page.access_token;

  if (platform === 'facebook') {
    return await uploadVideoToFacebook(file, title, description, pageId, pageAccessToken, options);
  } else {
    // Instagram
    // Use selected instagramAccountId or fetch from page
    let igUserId = options.instagramAccountId;
    
    if (!igUserId) {
      const igResponse = await fetch(`https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`);
      const igData = await igResponse.json();
      
      if (!igData.instagram_business_account) {
        throw new Error('No Instagram Business Account linked to this Facebook Page.');
      }
      igUserId = igData.instagram_business_account.id;
    }
    
    // For Instagram, the User Access Token (accessToken) is often preferred 
    // if it has the instagram_content_publish permission.
    return await uploadVideoToInstagram(file, title, description, igUserId, accessToken, options);
  }
}

async function uploadVideoToInstagram(file: File, title: string, description: string, igUserId: string, accessToken: string, options: any = {}) {
  console.log(`Starting Instagram Reel upload for IG User: ${igUserId}`);
  
  // 1. Initialize (Start)
  const initResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igUserId}/video_reels`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'start',
        access_token: accessToken,
      }),
    }
  );

  const initData = await initResponse.json();
  if (!initResponse.ok) throw new Error(`Instagram Init Failed: ${JSON.stringify(initData)}`);

  const { video_id, upload_url } = initData;
  console.log(`Instagram upload initialized. Video ID: ${video_id}`);

  // 2. Transfer (Binary)
  // Note: For Instagram, we use the upload_url provided in the start phase
  const uploadResponse = await fetch(upload_url, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${accessToken}`,
      'offset': '0',
      'file_size': file.size.toString(),
      'Content-Type': 'application/octet-stream',
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    const err = await uploadResponse.json();
    throw new Error(`Instagram Transfer Failed: ${JSON.stringify(err)}`);
  }
  console.log('Instagram video data transferred successfully.');

  // 3. Finish
  const finishResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igUserId}/video_reels`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'finish',
        access_token: accessToken,
        video_id,
        video_state: 'PUBLISHED',
        caption: options.caption || `${title}\n\n${description}`,
      }),
    }
  );

  const finishData = await finishResponse.json();
  if (!finishResponse.ok) throw new Error(`Instagram Finish Failed: ${JSON.stringify(finishData)}`);
  console.log('Instagram upload finished. Polling for status...');

  // 4. Poll for status
  let attempts = 0;
  const maxAttempts = 20;
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    
    const statusResponse = await fetch(`https://graph.facebook.com/v18.0/${video_id}?fields=status_code&access_token=${accessToken}`);
    const statusData = await statusResponse.json();
    
    console.log(`Instagram status check (${attempts + 1}):`, statusData.status_code);
    
    if (statusData.status_code === 'FINISHED') {
      break;
    } else if (statusData.status_code === 'ERROR') {
      throw new Error('Instagram processing failed.');
    }
    
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error('Instagram processing timed out.');
  }

  // 5. Publish
  console.log('Publishing Instagram Reel...');
  const publishResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igUserId}/video_reels_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        video_id,
      }),
    }
  );

  const publishData = await publishResponse.json();
  if (!publishResponse.ok) throw new Error(`Instagram Publish Failed: ${JSON.stringify(publishData)}`);

  return { id: publishData.id, link: `https://www.instagram.com/reels/${publishData.id}/` };
}

async function uploadVideoToFacebook(file: File, title: string, description: string, targetId: string, accessToken: string, options: any = {}) {
  // 1. Initialize
  const initResponse = await fetch(
    `https://graph.facebook.com/v18.0/${targetId}/videos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'start',
        access_token: accessToken,
        file_size: file.size,
      }),
    }
  );

  const initData = await initResponse.json();
  if (!initResponse.ok) throw new Error(`Meta Init Failed: ${JSON.stringify(initData)}`);

  const { upload_session_id, video_id } = initData;

  // 2. Transfer
  const uploadFormData = new FormData();
  uploadFormData.append('upload_phase', 'transfer');
  uploadFormData.append('access_token', accessToken);
  uploadFormData.append('upload_session_id', upload_session_id);
  uploadFormData.append('start_offset', '0');
  uploadFormData.append('video_file_chunk', file);

  const uploadResponse = await fetch(
    `https://graph.facebook.com/v18.0/${targetId}/videos`,
    {
      method: 'POST',
      body: uploadFormData,
    }
  );
  
  if (!uploadResponse.ok) {
    const err = await uploadResponse.json();
    throw new Error(`Meta Transfer Failed: ${JSON.stringify(err)}`);
  }

  // 3. Finish
  const finishResponse = await fetch(
    `https://graph.facebook.com/v18.0/${targetId}/videos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upload_phase: 'finish',
        access_token: accessToken,
        upload_session_id,
        title,
        description,
        privacy: JSON.stringify({ value: options.privacy || 'EVERYONE' }),
      }),
    }
  );

  if (!finishResponse.ok) {
    const err = await finishResponse.json();
    throw new Error(`Meta Finish Failed: ${JSON.stringify(err)}`);
  }

  return { id: video_id };
}
