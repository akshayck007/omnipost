import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { tempVideoMap } from '@/lib/temp-storage';
import { v4 as uuidv4 } from 'uuid';

// Helper to safely parse JSON from Meta responses
async function safeJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse Meta response:', text.substring(0, 500));
    return { error: { message: `Invalid JSON response: ${text.substring(0, 100)}` } };
  }
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
    const youtubeThumbnail = formData.get('youtubeThumbnail');
    const instagramThumbnail = formData.get('instagramThumbnail');
    const facebookThumbnail = formData.get('facebookThumbnail');

    if (!video) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID is missing. Please ensure you are logged in.' }, { status: 400 });
    }

    console.log(`Starting multi-platform upload for user ${userId} to: ${platforms.join(', ')}`);
    console.log('YouTube Token Present:', !!tokens.youtube);
    console.log('YouTube Refresh Token Present:', !!tokens.youtube?.refresh_token);
    console.log('Meta Token Present:', !!tokens.meta);
    console.log('TikTok Token Present:', !!tokens.tiktok);
    
    // Process all platforms
    // We'll do YouTube and TikTok in parallel with Meta, but Meta platforms sequentially to each other
    const results: any[] = [];
    
    // 1. YouTube (Parallel)
    const youtubePromise = (async () => {
      if (platforms.includes('youtube')) {
        try {
          if (!tokens.youtube) return { platform: 'youtube', status: 'error', message: 'YouTube account not connected' };
          
          const ytThumbnailFile = (youtubeThumbnail instanceof File && youtubeThumbnail.size > 0) ? youtubeThumbnail : undefined;
          
          const ytResult = await uploadToYouTube(
            video, 
            title, 
            description, 
            tokens.youtube.access_token, 
            options.youtube,
            tokens.youtube.refresh_token,
            userId,
            ytThumbnailFile
          );
          return { platform: 'youtube', status: 'success', ...ytResult };
        } catch (err: any) {
          console.error(`Error uploading to youtube:`, err);
          return { platform: 'youtube', status: 'error', message: err.message };
        }
      }
      return null;
    })();

    // 1.5 TikTok (Parallel)
    const tiktokPromise = (async () => {
      if (platforms.includes('tiktok')) {
        try {
          if (!tokens.tiktok) return { platform: 'tiktok', status: 'error', message: 'TikTok account not connected' };
          
          const tiktokFormData = new FormData();
          tiktokFormData.append('video', video);
          tiktokFormData.append('accessToken', tokens.tiktok.access_token);
          tiktokFormData.append('caption', options.tiktok?.caption || description || title);
          tiktokFormData.append('privacyLevel', options.tiktok?.privacy_level || 'PUBLIC_TO_EVERYONE');
          tiktokFormData.append('allowComments', String(options.tiktok?.allow_comments ?? true));
          tiktokFormData.append('allowDuet', String(options.tiktok?.allow_duet ?? true));
          tiktokFormData.append('allowStitch', String(options.tiktok?.allow_stitch ?? true));

          const tiktokResponse = await fetch(`${process.env.APP_URL}/api/upload/tiktok`, {
            method: 'POST',
            body: tiktokFormData,
          });

          const tiktokData = await tiktokResponse.json();
          if (!tiktokResponse.ok || tiktokData.error) {
            throw new Error(tiktokData.error || 'TikTok upload failed');
          }

          return { platform: 'tiktok', status: 'success', ...tiktokData };
        } catch (err: any) {
          console.error(`Error uploading to tiktok:`, err);
          return { platform: 'tiktok', status: 'error', message: err.message };
        }
      }
      return null;
    })();

    // 2. Meta Platforms (Sequential to each other to avoid bandwidth/concurrency issues)
    const metaResults: any[] = [];
    if (platforms.includes('instagram') || platforms.includes('facebook')) {
      if (!tokens.meta) {
        if (platforms.includes('instagram')) metaResults.push({ platform: 'instagram', status: 'error', message: 'Meta account not connected' });
        if (platforms.includes('facebook')) metaResults.push({ platform: 'facebook', status: 'error', message: 'Meta account not connected' });
      } else {
        // Sequential Meta uploads
        if (platforms.includes('facebook')) {
          try {
            const fbThumbnailFile = (facebookThumbnail instanceof File && facebookThumbnail.size > 0) ? facebookThumbnail : undefined;
            const fbResult = await uploadToMeta(video, title, description, tokens.meta.access_token, 'facebook', options, fbThumbnailFile, userId);
            metaResults.push({ platform: 'facebook', status: 'success', ...fbResult });
          } catch (err: any) {
            console.error(`Error uploading to facebook:`, err);
            metaResults.push({ platform: 'facebook', status: 'error', message: err.message });
          }
        }
        if (platforms.includes('instagram')) {
          try {
            const igThumbnailFile = (instagramThumbnail instanceof File && instagramThumbnail.size > 0) ? instagramThumbnail : undefined;
            const igResult = await uploadToMeta(video, title, description, tokens.meta.access_token, 'instagram', options, igThumbnailFile, userId);
            metaResults.push({ platform: 'instagram', status: 'success', ...igResult });
          } catch (err: any) {
            console.error(`Error uploading to instagram:`, err);
            metaResults.push({ platform: 'instagram', status: 'error', message: err.message });
          }
        }
      }
    }

    const [ytResult, ttResult] = await Promise.all([youtubePromise, tiktokPromise]);
    if (ytResult) results.push(ytResult);
    if (ttResult) results.push(ttResult);
    results.push(...metaResults);

    // The client-side will handle saving the upload record to Firestore history.
    // We only return the results here.
    return NextResponse.json({ results });
  } catch (error: any) {
    console.error('Global Upload Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Upload failed',
      details: error.toString()
    }, { status: 500 });
  }
}

async function refreshYouTubeToken(refreshToken: string) {
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

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`YouTube Token Refresh Failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function uploadYouTubeThumbnail(videoId: string, thumbnailFile: File, accessToken: string) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': thumbnailFile.type || 'image/jpeg'
        },
        body: thumbnailFile
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      console.error('YouTube Thumbnail Upload Failed:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error uploading YouTube thumbnail:', err);
    return false;
  }
}

async function uploadToYouTube(file: File, title: string, description: string, accessToken: string, options: any = {}, refreshToken?: string, userId?: string, thumbnail?: File) {
  // Use platform specific title if provided
  const finalTitle = options.title || title;
  
  // YouTube Data API v3
  // 1. Initialize resumable upload
  const metadata = {
    snippet: {
      title: finalTitle,
      description: options.description || description,
      categoryId: options.category || '22', // People & Blogs
      tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : []
    },
    status: {
      privacyStatus: options.privacy || 'public',
      selfDeclaredMadeForKids: false
    }
  };

  let currentToken = accessToken;

  const performInit = async (token: string) => {
    return await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': file.size.toString(),
          'X-Upload-Content-Type': file.type || 'video/mp4'
        },
        body: JSON.stringify(metadata)
      }
    );
  };

  let initResponse = await performInit(currentToken);

  // Handle 401 Unauthorized by refreshing token
  if (initResponse.status === 401) {
    console.log(`YouTube 401 Unauthorized. Refresh token present: ${!!refreshToken}`);
    if (refreshToken) {
      console.log('YouTube token expired, attempting refresh...');
      try {
        const newTokens = await refreshYouTubeToken(refreshToken);
        currentToken = newTokens.access_token;
        console.log('YouTube token refreshed successfully.');
        
        // Update Firestore with new token
        // The client-side will handle updating the token in Firestore if newTokens is returned.
        // We only log it here.
        console.log('YouTube token refreshed successfully. Returning new tokens to client.');
        
        // Retry init with new token
        initResponse = await performInit(currentToken);
      } catch (refreshErr) {
        console.error('Failed to refresh YouTube token:', refreshErr);
      }
    } else {
      console.error('YouTube 401 but no refresh token available.');
    }
  }

  if (!initResponse.ok) {
    const error = await initResponse.json();
    console.error('YouTube Init Error Data:', JSON.stringify(error));
    let message = error.error?.message || JSON.stringify(error);
    
    // Check for authentication errors specifically
    if (initResponse.status === 401 || message.toLowerCase().includes('invalid credentials') || message.toLowerCase().includes('authentication')) {
      message = 'YouTube authentication failed. Please disconnect and reconnect your YouTube account to refresh access.';
    }
    
    // Specific handling for upload limit exceeded
    if (message.toLowerCase().includes('exceeded') && message.toLowerCase().includes('upload')) {
      throw new Error('YouTube Upload Limit Exceeded: You have reached your daily upload limit or your account needs phone verification. Please try again in 24 hours.');
    }
    
    throw new Error(`YouTube Init Failed: ${message}`);
  }

  const uploadUrl = initResponse.headers.get('Location');
  if (!uploadUrl) throw new Error('YouTube upload URL not received');

  // 2. Upload the video
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': file.size.toString()
    },
    body: file
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.json();
    throw new Error(`YouTube Upload Failed: ${error.error?.message || JSON.stringify(error)}`);
  }

  const result = await uploadResponse.json();
  
  // 3. Upload Thumbnail if provided
  if (thumbnail && result.id) {
    console.log(`Uploading thumbnail for YouTube video ${result.id}...`);
    await uploadYouTubeThumbnail(result.id, thumbnail, currentToken);
  }

  const expiresAt = currentToken !== accessToken ? Date.now() + 3600 * 1000 : null; // Approximate if we don't have the exact value here
  
  return { 
    id: result.id, 
    url: `https://youtu.be/${result.id}`, 
    newTokens: currentToken !== accessToken ? { 
      access_token: currentToken,
      expires_at: expiresAt 
    } : null 
  };
}

// Cache for Meta accounts to avoid redundant fetches in multi-platform requests
let metaAccountsCache: any = null;
let metaAccountsCacheTime = 0;

async function uploadVideoToStorage(file: File, userId: string) {
  try {
    if (!userId) {
      throw new Error('User ID is missing for storage upload');
    }
    console.log(`Uploading video to storage: ${file.name} (${file.size} bytes) for user ${userId}`);
    
    const bucket = adminStorage.bucket();
    console.log(`Using bucket: ${bucket.name} for storage upload`);
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `videos/${userId}/${Date.now()}_${sanitizedFileName}`;
    const blob = bucket.file(filePath);
    
    // Convert File to ArrayBuffer for better compatibility in Node environment
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    await blob.save(buffer, {
      contentType: file.type || 'video/mp4',
      metadata: {
        cacheControl: 'public, max-age=31536000',
      }
    });
    
    // Generate a signed URL that Meta can access
    const [url] = await blob.getSignedUrl({
      action: 'read',
      expires: '03-09-2491' // Far future
    });
    
    console.log(`Video uploaded to storage successfully: ${url}`);
    return url;
  } catch (err: any) {
    console.error('Error uploading video to storage:', err.message || err);
    throw new Error(`Storage Upload Failed: ${err.message || 'Unknown error'}`);
  }
}

async function uploadThumbnailToStorage(thumbnail: File, userId: string, platform: string) {
  try {
    if (!userId) {
      throw new Error('User ID is missing for thumbnail upload');
    }
    console.log(`Uploading ${platform} thumbnail to Storage: ${thumbnail.name} (${thumbnail.size} bytes)`);
    
    const bucket = adminStorage.bucket();
    const sanitizedFileName = thumbnail.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `thumbnails/${userId}/${platform}_${Date.now()}_${sanitizedFileName}`;
    const blob = bucket.file(filePath);
    
    const arrayBuffer = await thumbnail.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    await blob.save(buffer, {
      contentType: thumbnail.type || 'image/jpeg',
      metadata: {
        cacheControl: 'public, max-age=31536000',
      }
    });
    
    const [url] = await blob.getSignedUrl({
      action: 'read',
      expires: '03-09-2491'
    });
    
    console.log(`Thumbnail uploaded successfully: ${url}`);
    return url;
  } catch (err: any) {
    console.error(`Error uploading thumbnail to storage for ${platform}:`, err.message || err);
    throw new Error(`Thumbnail Storage Upload Failed: ${err.message || 'Unknown error'}`);
  }
}

async function uploadToMeta(file: File, title: string, description: string, accessToken: string, platform: 'facebook' | 'instagram', options: any = {}, thumbnail?: File, userId?: string) {
  // Use cached accounts if fresh (within 30 seconds)
  let pages = [];
  if (metaAccountsCache && (Date.now() - metaAccountsCacheTime < 30000)) {
    pages = metaAccountsCache;
  } else {
    const accountsResponse = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`);
    const accountsData = await safeJson(accountsResponse);
    if (accountsData.error) throw new Error(`Meta Account Error: ${JSON.stringify(accountsData.error)}`);
    pages = accountsData.data || [];
    metaAccountsCache = pages;
    metaAccountsCacheTime = Date.now();
  }

  if (pages.length === 0) {
    throw new Error('No Facebook Pages found. Please ensure you have a Page connected.');
  }

  // Use platform specific title/description if provided
  const platformOptions = platform === 'instagram' ? options.instagram : options.facebook;
  const finalTitle = platformOptions?.title || title;
  const finalDescription = platformOptions?.description || description;

  // Upload thumbnail to storage if provided
  let thumbnailUrl = null;
  if (thumbnail) {
    if (!userId) {
      console.warn(`Thumbnail provided for ${platform} but userId is missing. Skipping thumbnail upload.`);
    } else {
      console.log(`Uploading thumbnail to storage for ${platform}...`);
      thumbnailUrl = await uploadThumbnailToStorage(thumbnail, userId, platform);
    }
  }

  // For Instagram, we need to find the linked IG Business Account
  if (platform === 'instagram') {
    let igUserId = options.instagram?.instagramAccountId;
    let pageToken = accessToken;

    if (!igUserId) {
      // Try to find the first page with a linked IG account
      for (const page of pages) {
        const igResponse = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
        const igData = await safeJson(igResponse);
        if (igData.instagram_business_account) {
          igUserId = igData.instagram_business_account.id;
          pageToken = page.access_token;
          break;
        }
      }
    } else {
      // Find the token for the page that owns this IG account
      const targetPage = pages.find((p: any) => p.id === options.instagram?.pageId);
      if (targetPage) pageToken = targetPage.access_token;
    }

    if (!igUserId) {
      throw new Error('No Instagram Business/Creator Account found linked to your Facebook Pages.');
    }

    return await uploadVideoToInstagram(file, finalTitle, finalDescription, igUserId, accessToken, pageToken, options);
  } else {
    // Facebook Page Upload
    const pageId = options.facebook?.pageId || pages[0]?.id;
    if (!pageId) throw new Error('No Facebook Page found to upload to.');
    
    const targetPage = pages.find((p: any) => p.id === pageId) || pages[0];
    console.log(`Uploading to Facebook Page: ${targetPage.name} (${targetPage.id})`);
    
    return await uploadToFacebook(file, finalTitle, finalDescription, targetPage.id, targetPage.access_token);
  }
}

async function uploadToFacebook(file: File, title: string, description: string, pageId: string, pageToken: string) {
  // Facebook Reels Direct Upload Flow (Resumable)
  console.log(`Starting Facebook Reels direct upload for page ${pageId}`);
  
  // 1. Start Phase
  const startResponse = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/video_reels?upload_phase=START&access_token=${pageToken}`,
    { method: 'POST' }
  );
  const startData = await safeJson(startResponse);
  if (startData.error) throw new Error(`FB Start Phase Failed: ${JSON.stringify(startData.error)}`);
  
  const videoId = startData.video_id;
  console.log(`FB Start Phase Success. Video ID: ${videoId}`);

  // 2. Upload Phase
  console.log(`Uploading video bytes to Facebook (${file.size} bytes) via rupload...`);
  
  const arrayBuffer = await file.arrayBuffer();
  
  // Use the rupload endpoint which is the standard for Meta resumable uploads
  const ruploadUrl = `https://rupload.facebook.com/video-upload/v19.0/${videoId}`;
  
  const uploadResponse = await fetch(ruploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${pageToken}`,
      'offset': '0',
      'file_size': file.size.toString(),
      'Content-Type': 'application/octet-stream'
    },
    body: arrayBuffer
  });

  const uploadData = await safeJson(uploadResponse);
  if (uploadData.error) {
    console.error('Facebook rupload Phase Error:', JSON.stringify(uploadData.error));
    throw new Error(`FB Upload Phase Failed: ${JSON.stringify(uploadData.error)}`);
  }
  console.log('FB rupload Phase Success');

  // 3. Finish Phase
  console.log(`Finishing Facebook Reels upload for video ${videoId}...`);
  
  const finishParams = new URLSearchParams({
    upload_phase: 'FINISH',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description: description,
    access_token: pageToken
  });

  const finishResponse = await fetch(`https://graph.facebook.com/v19.0/${pageId}/video_reels?${finishParams.toString()}`, {
    method: 'POST'
  });
  
  const finishData = await safeJson(finishResponse);
  if (finishData.error) throw new Error(`FB Finish Phase Failed: ${JSON.stringify(finishData.error)}`);

  return { id: videoId, url: `https://facebook.com/${videoId}` };
}

async function uploadVideoToInstagram(file: File, title: string, description: string, igUserId: string, userToken: string, pageToken: string, options: any = {}) {
  // Switch to Resumable Upload for Instagram Reels to avoid public URL requirements
  console.log(`Starting Instagram Reels resumable upload for ${igUserId}`);
  
  const caption = options.instagram?.caption || `${title}\n\n${description}`;
  
  // 1. Initialize Resumable Upload
  console.log(`Initializing Instagram upload for IG User: ${igUserId} using Page Token (ending in ...${pageToken.slice(-5)})`);
  const initUrl = `https://graph.facebook.com/v19.0/${igUserId}/media?media_type=REELS&upload_type=resumable&caption=${encodeURIComponent(caption)}&access_token=${pageToken}`;
  
  let initResponse = await fetch(initUrl, { method: 'POST' });
  let initData = await safeJson(initResponse);
  console.log('Instagram Init Response:', JSON.stringify(initData));
  
  if (initData.error) {
    console.log('Instagram Resumable Init failed with page token, retrying with user token...');
    const retryUrl = `https://graph.facebook.com/v19.0/${igUserId}/media?media_type=REELS&upload_type=resumable&caption=${encodeURIComponent(caption)}&access_token=${userToken}`;
    initResponse = await fetch(retryUrl, { method: 'POST' });
    initData = await safeJson(initResponse);
    console.log('Instagram Init Retry Response:', JSON.stringify(initData));
    if (initData.error) throw new Error(`Instagram Resumable Init Failed: ${JSON.stringify(initData.error)}`);
  }

  const uploadId = initData.upload_id || initData.id;
  const ruploadUrl = initData.uri || `https://rupload.facebook.com/video-upload/v19.0/${uploadId}`;
  
  if (!uploadId) {
    throw new Error(`Instagram Resumable Init succeeded but no upload_id was returned. Response: ${JSON.stringify(initData)}`);
  }
  console.log(`Instagram Resumable Upload initialized. Upload ID: ${uploadId}`);

  // 2. Upload Video Bytes via rupload
  console.log(`Uploading video bytes to Instagram (${file.size} bytes) via ${ruploadUrl}...`);
  const arrayBuffer = await file.arrayBuffer();
  
  const uploadResponse = await fetch(ruploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `OAuth ${pageToken}`,
      'offset': '0',
      'file_size': file.size.toString(),
      'Content-Type': 'application/octet-stream'
    },
    body: arrayBuffer
  });
  
  let uploadData = await safeJson(uploadResponse);
  console.log('Instagram rupload Response:', JSON.stringify(uploadData));

  if (uploadData.error) {
    console.log('Instagram rupload failed with page token, retrying with user token...');
    const retryUpload = await fetch(ruploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${userToken}`,
        'offset': '0',
        'file_size': file.size.toString(),
        'Content-Type': 'application/octet-stream'
      },
      body: arrayBuffer
    });
    uploadData = await safeJson(retryUpload);
    console.log('Instagram rupload Retry Response:', JSON.stringify(uploadData));
    if (uploadData.error) throw new Error(`Instagram rupload Failed: ${JSON.stringify(uploadData.error)}`);
  }

  // For Instagram Reels Resumable, the ID from the INIT response is the Container ID
  const containerId = initData.id || initData.upload_id;
  if (!containerId) {
    throw new Error(`Instagram upload succeeded but no container ID was found. Init Response: ${JSON.stringify(initData)}`);
  }
  console.log(`Instagram Media Container identified: ${containerId}`);

  // 3. Poll for processing status
  let isReady = false;
  let attempts = 0;
  const maxAttempts = 10; 

  while (!isReady && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 10000));
    const statusResponse = await fetch(`https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${pageToken}`);
    const statusData = await safeJson(statusResponse);
    
    console.log(`Instagram status check ${attempts + 1} for ${containerId}:`, JSON.stringify(statusData));

    if (statusData.error) {
      console.error(`Instagram status check failed: ${statusData.error.message}`);
      // Don't throw yet, maybe it's a temporary error
    } else if (statusData.status_code === 'FINISHED') {
      isReady = true;
    } else if (statusData.status_code === 'ERROR') {
      throw new Error(`Instagram processing failed. This often happens if the video format is not supported or the file is corrupted.`);
    }
    attempts++;
  }

  if (!isReady) {
    return { 
      status: 'processing', 
      id: containerId, 
      igUserId: igUserId,
      message: 'Video is still being processed by Instagram. It will be published automatically once ready.' 
    };
  }

  // 4. Publish
  console.log(`Publishing Instagram Media Container: ${containerId} for IG User: ${igUserId}...`);
  const publishResponse = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media_publish?creation_id=${containerId}&access_token=${pageToken}`,
    { method: 'POST' }
  );
  
  const publishData = await safeJson(publishResponse);
  console.log('Instagram Publish Response:', JSON.stringify(publishData));

  if (publishData.error) {
    console.log('Instagram publish failed with page token, retrying with user token...');
    const retryPublish = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish?creation_id=${containerId}&access_token=${userToken}`,
      { method: 'POST' }
    );
    const retryData = await safeJson(retryPublish);
    console.log('Instagram Publish Retry Response:', JSON.stringify(retryData));
    if (retryData.error) throw new Error(`Instagram Publish Failed: ${JSON.stringify(retryData.error)}`);
    return { id: retryData.id, url: `https://instagram.com/reels/${retryData.id}` };
  }

  return { id: publishData.id, url: `https://instagram.com/reels/${publishData.id}` };
}
