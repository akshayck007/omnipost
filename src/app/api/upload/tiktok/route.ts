import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const video = formData.get('video') as File;
    const accessToken = formData.get('accessToken') as string;
    const caption = formData.get('caption') as string;
    const privacyLevel = formData.get('privacyLevel') as string || 'PUBLIC_TO_EVERYONE';
    const allowComments = formData.get('allowComments') === 'true';
    const allowDuet = formData.get('allowDuet') === 'true';
    const allowStitch = formData.get('allowStitch') === 'true';

    if (!video || !accessToken) {
      return NextResponse.json({ error: 'Missing video or access token' }, { status: 400 });
    }

    console.log(`Starting TikTok upload for video: ${video.name} (${video.size} bytes)`);

    // 1. Initialize Upload
    const initResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title: caption || '',
          privacy_level: privacyLevel,
          disable_comment: !allowComments,
          disable_duet: !allowDuet,
          disable_stitch: !allowStitch,
          video_ad_tag: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: video.size,
          chunk_size: video.size,
          total_chunk_count: 1,
        },
      }),
    });

    const initData = await initResponse.json();
    console.log('TikTok Init Response:', JSON.stringify(initData));

    if (!initResponse.ok || initData.error) {
      throw new Error(`TikTok Init Failed: ${initData.error?.message || JSON.stringify(initData)}`);
    }

    const { upload_url, publish_id } = initData.data;

    // 2. Upload Video Bytes
    const videoBuffer = await video.arrayBuffer();
    const uploadResponse = await fetch(upload_url, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes 0-${video.size - 1}/${video.size}`,
        'Content-Type': video.type || 'video/mp4',
      },
      body: Buffer.from(videoBuffer),
    });

    if (!uploadResponse.ok) {
      const uploadError = await uploadResponse.text();
      console.error('TikTok Upload Error:', uploadError);
      throw new Error(`TikTok Video Upload Failed: ${uploadResponse.statusText}`);
    }

    console.log('TikTok Upload Success. Publish ID:', publish_id);

    return NextResponse.json({
      success: true,
      publishId: publish_id,
    });
  } catch (error: any) {
    console.error('Error in TikTok upload route:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
