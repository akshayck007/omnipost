import { NextRequest, NextResponse } from 'next/server';

async function safeJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { error: { message: `Invalid JSON response: ${text.substring(0, 100)}` } };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { containerId, accessToken, igUserId } = await request.json();

    if (!containerId || !accessToken || !igUserId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 1. Check status
    console.log(`Checking Instagram status for container ${containerId}...`);
    // error_message is not a valid field for media containers. 
    // We should check status_code.
    const statusResponse = await fetch(`https://graph.facebook.com/v19.0/${containerId}?fields=status_code&access_token=${accessToken}`);
    const statusData = await safeJson(statusResponse);
    console.log(`Instagram status check result: ${JSON.stringify(statusData)}`);

    if (statusData.error) {
      console.error(`Instagram status check failed: ${statusData.error.message}`);
      return NextResponse.json({ status: 'error', message: statusData.error.message }, { status: 400 });
    }

    if (statusData.status_code === 'FINISHED') {
      // 2. Publish
      console.log(`Instagram processing finished. Publishing container ${containerId}...`);
      const publishResponse = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/media_publish?creation_id=${containerId}&access_token=${accessToken}`,
        { method: 'POST' }
      );
      const publishData = await safeJson(publishResponse);
      console.log(`Instagram publish result: ${JSON.stringify(publishData)}`);
      
      if (publishData.error) {
        console.error(`Instagram publish failed: ${publishData.error.message}`);
        return NextResponse.json({ status: 'error', message: publishData.error.message }, { status: 400 });
      }
      
      return NextResponse.json({ 
        status: 'success', 
        id: publishData.id, 
        url: `https://instagram.com/reels/${publishData.id}` 
      });
    } else if (statusData.status_code === 'ERROR') {
      console.error(`Instagram processing failed with ERROR status`);
      return NextResponse.json({ 
        status: 'error', 
        message: 'Instagram processing failed. This often happens if the video format is not supported or the file is corrupted.' 
      }, { status: 400 });
    } else {
      console.log(`Instagram still processing: ${statusData.status_code}`);
      return NextResponse.json({ status: 'processing', message: `Still processing (${statusData.status_code})...` });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
