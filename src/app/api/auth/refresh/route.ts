import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const { userId, provider, refreshToken: clientRefreshToken } = await request.json();
    console.log(`Refreshing token for userId: ${userId}, provider: ${provider}`);
    
    if (!userId || !provider) {
      return NextResponse.json({ error: 'Missing userId or provider' }, { status: 400 });
    }

    let refreshToken = clientRefreshToken;

    // If no refresh token provided by client, try to get it from Firestore
    if (!refreshToken) {
      console.log('No refresh token provided by client, attempting to fetch from Firestore...');
      try {
        const userRef = adminDb.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (!userDoc.exists) {
          return NextResponse.json({ error: 'User not found in database' }, { status: 404 });
        }
        
        const data = userDoc.data() || {};
        const tokens = data.tokens || {};
        const providerTokens = tokens[provider];
        
        if (!providerTokens || !providerTokens.refresh_token) {
          return NextResponse.json({ error: `No refresh token found for ${provider} in database` }, { status: 400 });
        }
        refreshToken = providerTokens.refresh_token;
      } catch (dbError: any) {
        console.error('Firestore Admin SDK Read Error:', dbError.message);
        return NextResponse.json({ 
          error: 'Failed to fetch refresh token from database', 
          details: dbError.message,
          code: dbError.code
        }, { status: 500 });
      }
    }
    
    if (provider === 'google' || provider === 'youtube') {
      console.log('Calling Google OAuth2 token endpoint...');
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
      
      const refreshData = await response.json();
      
      if (!response.ok) {
        console.error('Google Token Refresh Failed:', JSON.stringify(refreshData));
        return NextResponse.json({ error: 'Failed to refresh YouTube token', details: refreshData }, { status: response.status });
      }
      
      console.log('Google Token Refresh Success.');
      const newAccessToken = refreshData.access_token;
      const expiresAt = Date.now() + (refreshData.expires_in * 1000);
      
      // Attempt to update Firestore (non-blocking for the response)
      try {
        const updateKey = provider === 'google' ? 'google' : 'youtube';
        const userRef = adminDb.collection('users').doc(userId);
        await userRef.update({
          [`tokens.${updateKey}.access_token`]: newAccessToken,
          [`tokens.${updateKey}.expires_at`]: expiresAt
        });
        console.log('Firestore updated successfully by Admin SDK.');
      } catch (updateError: any) {
        console.warn('Firestore Admin SDK Update failed (will rely on client-side update):', updateError.message);
      }
      
      return NextResponse.json({ 
        access_token: newAccessToken, 
        expires_at: expiresAt 
      });
    }
    
    return NextResponse.json({ error: 'Provider not supported for refresh' }, { status: 400 });
    
  } catch (error: any) {
    console.error('Refresh Token Error:', error);
    return NextResponse.json({ error: error.message || 'Refresh failed' }, { status: 500 });
  }
}
