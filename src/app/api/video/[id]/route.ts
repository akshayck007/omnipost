import { NextRequest, NextResponse } from 'next/server';
import { tempVideoMap } from '@/lib/temp-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const videoData = tempVideoMap.get(id);

  if (!videoData) {
    return new NextResponse('Video not found or expired', { status: 404 });
  }

  return new NextResponse(videoData.buffer, {
    headers: {
      'Content-Type': videoData.contentType,
      'Content-Length': videoData.buffer.length.toString(),
      'Cache-Control': 'public, max-age=600',
    },
  });
}
