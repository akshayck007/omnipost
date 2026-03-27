'use client';

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Share2, 
  Settings, 
  Plus, 
  Youtube, 
  Instagram, 
  Facebook, 
  Video, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  LogOut,
  X,
  Upload,
  Trash2,
  RefreshCw,
  ImageIcon,
  Music
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SocialAccount, UploadResult } from '../types';
import { auth, db, signInWithGoogle } from '../lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, where, orderBy, onSnapshot, limit, Unsubscribe, getDocFromServer, addDoc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
import Image from 'next/image';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformStatus, setPlatformStatus] = useState<Record<string, 'pending' | 'uploading' | 'processing' | 'success' | 'error'>>({});
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadResults, setUploadResults] = useState<any[] | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState<UploadResult | null>(null);
  const [deletePlatforms, setDeletePlatforms] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeUploadTab, setActiveUploadTab] = useState<'general' | 'youtube' | 'instagram' | 'facebook' | 'tiktok'>('general');
  const [uploadData, setUploadData] = useState({
    title: '',
    description: '',
    platforms: [] as string[],
    video: null as File | null
  });
  const [uploadOptions, setUploadOptions] = useState({
    youtube: { title: '', privacy: 'unlisted', tags: '', category: '22', thumbnail: null as File | null },
    instagram: { title: '', caption: '', instagramAccountId: '', thumbnail: null as File | null },
    facebook: { title: '', privacy: 'EVERYONE', pageId: '', thumbnail: null as File | null },
    tiktok: { title: '', caption: '', privacy_level: 'PUBLIC_TO_EVERYONE', allow_comments: true, allow_duet: true, allow_stitch: true }
  });
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [history, setHistory] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [initTimeout, setInitTimeout] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isRefreshingMeta, setIsRefreshingMeta] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagResult, setTagResult] = useState<{ name: string, media_count: number } | null>(null);
  const [isSearchingTag, setIsSearchingTag] = useState(false);

  const checkHashtag = async (query: string) => {
    if (!query || query.length < 2) return;
    
    const metaAccount = accounts.find(a => a.platform === 'meta');
    const accessToken = metaAccount?.tokens?.access_token;
    
    // Find the selected Instagram account ID
    let instagramAccountId = uploadOptions.instagram.instagramAccountId;
    
    // Fallback to first account if none selected
    if (!instagramAccountId && metaAccount?.instagramAccounts?.length) {
      instagramAccountId = metaAccount.instagramAccounts[0].id;
    }

    if (!accessToken) {
      setNotification({ message: 'Authentication token missing. Please reconnect your Meta account.', type: 'error' });
      return;
    }

    if (!instagramAccountId) {
      setNotification({ message: 'No Instagram Business account found. Please ensure your account is connected to a Facebook Page.', type: 'error' });
      return;
    }

    setIsSearchingTag(true);
    setTagResult(null);
    try {
      const res = await fetch('/api/instagram/hashtag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          hashtag: query.replace('#', ''), 
          instagramAccountId, 
          accessToken 
        })
      });
      const data = await res.json();
      
      if (data.error) {
        setNotification({ message: data.error, type: 'error' });
      } else {
        setTagResult(data);
      }
    } catch (err) {
      console.error('Error checking hashtag:', err);
      setNotification({ message: 'Failed to check hashtag', type: 'error' });
    } finally {
      setIsSearchingTag(false);
    }
  };

  const refreshMetaAccounts = async () => {
    if (!user?.uid) return;
    setIsRefreshingMeta(true);
    setNotification(null);
    try {
      console.log('Starting client-side Meta refresh...');
      // 1. Get fresh tokens from Firestore
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDocFromServer(userDocRef);
      if (!userDoc.exists()) throw new Error('User profile not found');
      
      const tokens = userDoc.data().tokens?.meta;
      if (!tokens?.access_token) throw new Error('Meta account not connected');
      
      const accessToken = tokens.access_token;
      
      // 2. Fetch Pages and IG accounts in one go (more robust)
      console.log('Fetching Facebook Pages and linked Instagram accounts...');
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=name,id,access_token,instagram_business_account{id,username,name}&access_token=${accessToken}`);
      const pagesData = await pagesRes.json();
      
      if (pagesData.error) throw new Error(`Meta API Error: ${pagesData.error.message}`);
      
      const igAccounts: any[] = [];
      const pages: any[] = [];
      
      if (pagesData.data) {
        for (const page of pagesData.data) {
          let igErrorMsg = null;
          
          // Check if IG account was returned in the bulk request
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
          } else {
            // If not in bulk, try a targeted check as fallback
            try {
              console.log(`Targeted check for Page: ${page.name} (${page.id})`);
              const tokenToUse = page.access_token || accessToken;
              const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account{id,username,name},instagram_accounts{id,username,name}&access_token=${tokenToUse}`);
              const igData = await igRes.json();
              
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
              } else if (igData.instagram_accounts?.data) {
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
              } else if (igData.error) {
                // If we already found IG accounts elsewhere, don't show this error to the user
                if (igAccounts.length === 0) {
                  igErrorMsg = igData.error.message;
                }
              } else {
                igErrorMsg = "No linked Instagram account found.";
              }
            } catch (e: any) {
              console.error(`Error in targeted check for ${page.id}:`, e);
            }
          }
          pages.push({ id: page.id, name: page.name, igError: igErrorMsg });
        }
      }
      
      // 3. Try direct discovery as well
      try {
        console.log('Trying direct Instagram discovery...');
        const directIgRes = await fetch(`https://graph.facebook.com/v19.0/me/instagram_business_accounts?access_token=${accessToken}`);
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
      
      // 4. Update Firestore
      console.log('Updating Firestore with discovered accounts:', igAccounts.length);
      await updateDoc(userDocRef, {
        'tokens.meta.instagramAccounts': igAccounts,
        'tokens.meta.pages': pages,
        'tokens.meta.lastRefreshed': new Date().toISOString()
      });
      
      setNotification({ message: `Successfully refreshed! Found ${igAccounts.length} Instagram accounts.`, type: 'success' });
    } catch (err: any) {
      console.error('Refresh failed:', err);
      setError(`Failed to refresh accounts: ${err.message}`);
    } finally {
      setIsRefreshingMeta(false);
    }
  };

  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        setInitTimeout(true);
      }, 10000);
      return () => clearTimeout(timer);
    } else {
      setInitTimeout(false);
    }
  }, [loading]);

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
          setError("Firebase is offline. Please check your connection or configuration.");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    console.log('Page mounted, setting up auth listener...');
    let unsubUser: Unsubscribe | null = null;
    let unsubHistory: Unsubscribe | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      console.log('Auth state changed event received:', currentUser?.email || 'No user');
      
      // Clean up previous listeners if user changed
      if (unsubUser) unsubUser();
      if (unsubHistory) unsubHistory();
      
      setUser(currentUser);
      
      if (currentUser) {
        console.log('User authenticated, setting up Firestore listeners...');
        
        // Ensure user document exists
        const userDocRef = doc(db, 'users', currentUser.uid);
        try {
          console.log('Checking user document existence for:', currentUser.uid);
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            console.log('Creating initial user document...');
            await setDoc(userDocRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: new Date().toISOString(),
              tokens: {}
            });
          }
          console.log('User document check complete.');
        } catch (err) {
          console.error('Error checking/creating user doc:', err);
          const errInfo = handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`);
          setError(errInfo.error);
        }

        unsubUser = onSnapshot(userDocRef, (docSnap) => {
          console.log('User document snapshot received, exists:', docSnap.exists());
          if (docSnap.exists()) {
            const data = docSnap.data();
            const tokens = data.tokens || {};
            console.log('Current tokens in DB:', Object.keys(tokens));
            const newAccounts: SocialAccount[] = [];
            
            if (tokens.youtube) {
              newAccounts.push({ 
                id: 'google', 
                platform: 'youtube', 
                name: 'YouTube', 
                connected: true,
                tokens: tokens.youtube,
                accountName: tokens.youtube.accountName,
                profilePicture: tokens.youtube.profilePicture
              });
            }
            
            if (tokens.meta) {
              newAccounts.push({ 
                id: 'meta', 
                platform: 'meta', 
                name: 'Meta (FB/IG)', 
                connected: true,
                tokens: tokens.meta,
                pages: tokens.meta.pages,
                instagramAccounts: tokens.meta.instagramAccounts,
                hasInstagramPublishPermission: tokens.meta.hasInstagramPublishPermission,
                rawPermissions: tokens.meta.rawPermissions
              });
            }
            
            if (tokens.tiktok) {
              newAccounts.push({ 
                id: 'tiktok', 
                platform: 'tiktok', 
                name: 'TikTok', 
                connected: true,
                tokens: tokens.tiktok,
                accountName: tokens.tiktok.user?.display_name,
                profilePicture: tokens.tiktok.user?.avatar_url
              });
            }
            
            console.log('Setting accounts state:', newAccounts);
            setAccounts(newAccounts);
          } else {
            console.log('User document does not exist, clearing accounts');
            setAccounts([]);
          }
        }, (err) => {
          const errInfo = handleFirestoreError(err, OperationType.GET, `users/${currentUser.uid}`);
          setError(errInfo.error);
        });

        // Sync upload history
        const historyQuery = query(
          collection(db, 'uploads'),
          where('userId', '==', currentUser.uid),
          orderBy('timestamp', 'desc'),
          limit(10)
        );
        
        unsubHistory = onSnapshot(historyQuery, (snapshot) => {
          console.log('Uploads history snapshot received, count:', snapshot.size);
          const newHistory = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as UploadResult[];
          setHistory(newHistory);
        }, (err) => {
          const errInfo = handleFirestoreError(err, OperationType.LIST, 'uploads');
          setError(errInfo.error);
        });

        setLoading(false);
      } else {
        console.log('No user authenticated, clearing state...');
        setAccounts([]);
        setHistory([]);
        setLoading(false);
      }
    }, (err) => {
      console.error('Auth listener error:', err);
      setLoading(false);
    });

    return () => {
      console.log('Cleaning up all listeners...');
      unsubscribeAuth();
      if (unsubUser) unsubUser();
      if (unsubHistory) unsubHistory();
    };
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const formatErrorMessage = (msg: string) => {
    if (!msg) return 'Upload failed';
    if (msg.includes('PERMISSION_DENIED')) {
      return 'Firestore Permission Denied. Please ensure you are logged in and have access to your profile.';
    }
    if (msg.includes('Object with ID') && msg.includes('does not exist')) {
      return `Instagram Error: Permission Denied. Meta says: "${msg}". To fix: Reconnect your Meta account and ensure you select ALL Instagram accounts and ALL Pages in the Facebook permissions window.`;
    }
    if (msg.includes('Instagram Account Access Error')) {
      return `Instagram Error: Could not access account. Meta says: "${msg.replace('Instagram Account Access Error: ', '')}". Please ensure it is a Business Account and linked to your Page.`;
    }
    try {
      if (msg.includes('{')) {
        const start = msg.indexOf('{');
        const end = msg.lastIndexOf('}') + 1;
        const jsonStr = msg.substring(start, end);
        const parsed = JSON.parse(jsonStr);
        
        let displayMsg = '';
        if (parsed.error?.message) displayMsg = parsed.error.message;
        else if (parsed.message) displayMsg = parsed.message;
        
        if (displayMsg) {
          // Add error code if available for better debugging
          if (parsed.error?.code || parsed.error?.error_subcode) {
            const code = parsed.error.code || '';
            const subcode = parsed.error.error_subcode ? ` (subcode: ${parsed.error.error_subcode})` : '';
            return `${displayMsg} [Meta Error ${code}${subcode}]`;
          }
          return displayMsg;
        }
      }
    } catch (e) {}
    return msg
      .replace('YouTube Init Failed: ', '')
      .replace('Meta Init Failed: ', '')
      .replace('YouTube Data Upload Failed: ', '')
      .replace('Instagram Upload Failed: ', '');
  };

  const pollInstagramStatus = async (containerId: string, accessToken: string, igUserId: string) => {
    let attempts = 0;
    const maxAttempts = 20; // Poll for up to 10 minutes (30s intervals)
    
    const poll = async () => {
      if (attempts >= maxAttempts) {
        setPlatformStatus(prev => ({ ...prev, instagram: 'error' }));
        setUploadResults(prev => {
          if (!prev) return prev;
          return prev.map(r => r.platform === 'instagram' ? { ...r, status: 'error', message: 'Instagram processing timed out. Please check your Instagram app later.' } : r);
        });
        setNotification({ message: 'Instagram processing timed out. Please check your Instagram app later.', type: 'error' });
        return;
      }

      try {
        const response = await fetch('/api/instagram/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ containerId, accessToken, igUserId })
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
          setPlatformStatus(prev => ({ ...prev, instagram: 'success' }));
          setUploadResults(prev => {
            if (!prev) return prev;
            return prev.map(r => r.platform === 'instagram' ? { ...r, status: 'success', url: data.url, id: data.id } : r);
          });
          setNotification({ message: 'Instagram Reel published successfully!', type: 'success' });
        } else if (data.status === 'error') {
          setPlatformStatus(prev => ({ ...prev, instagram: 'error' }));
          setUploadResults(prev => {
            if (!prev) return prev;
            return prev.map(r => r.platform === 'instagram' ? { ...r, status: 'error', message: data.message } : r);
          });
          setNotification({ message: `Instagram error: ${data.message}`, type: 'error' });
        } else {
          // Still processing
          attempts++;
          setTimeout(poll, 30000); // Poll every 30 seconds
        }
      } catch (err) {
        console.error('Instagram polling error:', err);
        attempts++;
        setTimeout(poll, 30000);
      }
    };

    setTimeout(poll, 30000);
  };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const { title, description, platforms, video: videoFile } = uploadData;
    
    if (!user) return;
    if (!videoFile) {
      setNotification({ message: 'Please select a video file', type: 'error' });
      return;
    }
    if (platforms.length === 0) {
      setNotification({ message: 'Please select at least one platform', type: 'error' });
      return;
    }
    
    try {
      setLoading(true);
      setNotification(null);
      
      // Initialize platform status
      const initialStatus: Record<string, 'pending' | 'uploading' | 'processing' | 'success' | 'error'> = {};
      platforms.forEach(p => initialStatus[p] = 'pending');
      setPlatformStatus(initialStatus);
      
      // Fetch tokens from Firestore (force fresh from server)
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDocFromServer(userDocRef);
      let tokens = userDoc.exists() ? (userDoc.data().tokens || {}) : {};
      console.log('Uploading with tokens for:', Object.keys(tokens));
      console.log('YouTube Token Present:', !!tokens.youtube);
      console.log('Meta Token Present:', !!tokens.meta);

      // Check if YouTube token is close to expiring (within 5 minutes)
      if (tokens.youtube && tokens.youtube.expires_at) {
        const fiveMinutes = 5 * 60 * 1000;
        const now = Date.now();
        const isExpiring = tokens.youtube.expires_at < (now + fiveMinutes);
        console.log(`YouTube token expires in: ${Math.round((tokens.youtube.expires_at - now) / 1000)}s`);
        
        if (isExpiring) {
          if (tokens.youtube.refresh_token) {
            console.log('YouTube token expiring soon, refreshing before upload...');
            try {
              const refreshRes = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  userId: user.uid, 
                  provider: 'youtube',
                  refreshToken: tokens.youtube.refresh_token // Pass token directly to bypass backend DB read issues
                })
              });
              if (refreshRes.ok) {
                const refreshData = await refreshRes.json();
                tokens.youtube.access_token = refreshData.access_token;
                tokens.youtube.expires_at = refreshData.expires_at;
                console.log('YouTube token refreshed successfully before upload');
                
                // Update Firestore from client side to ensure it's saved even if backend Admin SDK has issues
                const userDocRef = doc(db, 'users', user.uid);
                updateDoc(userDocRef, {
                  'tokens.youtube.access_token': refreshData.access_token,
                  'tokens.youtube.expires_at': refreshData.expires_at
                }).catch(e => console.error('Failed to update refreshed tokens in Firestore from client:', e));
              } else {
                const errData = await refreshRes.json();
                console.error('Failed to refresh YouTube token before upload:', JSON.stringify(errData));
                const details = errData.details || errData.error || 'Unknown error';
                const code = errData.code ? ` (${errData.code})` : '';
                throw new Error(`YouTube session refresh failed: ${details}${code}. Please reconnect your account.`);
              }
            } catch (refreshErr: any) {
              console.error('Error refreshing YouTube token before upload:', refreshErr);
              throw new Error(refreshErr.message || 'Failed to refresh YouTube session. Please reconnect your account.');
            }
          } else {
            console.warn('YouTube token is expiring but no refresh token is available.');
            throw new Error('Your YouTube session has expired. Please disconnect and reconnect your YouTube account to continue.');
          }
        }
      } else if (platforms.includes('youtube') && (!tokens.youtube || !tokens.youtube.access_token)) {
        console.error('YouTube selected but no token found');
        throw new Error('YouTube account not connected. Please connect your YouTube account first.');
      }

      const finalResults: any[] = [];

      // Send ONE request with all platforms to avoid sending the video multiple times
      setPlatformStatus(prev => {
        const next = { ...prev };
        platforms.forEach(p => next[p] = 'uploading');
        return next;
      });

      const multiPlatformFormData = new FormData();
      multiPlatformFormData.append('title', title);
      multiPlatformFormData.append('description', description);
      platforms.forEach(p => multiPlatformFormData.append('platforms', p));
      multiPlatformFormData.append('tokens', JSON.stringify(tokens));
      multiPlatformFormData.append('userId', user.uid);
      multiPlatformFormData.append('video', videoFile);
      
      // Append thumbnails
      if (platforms.includes('youtube') && uploadOptions.youtube.thumbnail) {
        multiPlatformFormData.append('youtubeThumbnail', uploadOptions.youtube.thumbnail);
      }
      if (platforms.includes('instagram') && uploadOptions.instagram.thumbnail) {
        multiPlatformFormData.append('instagramThumbnail', uploadOptions.instagram.thumbnail);
      }
      if (platforms.includes('facebook') && uploadOptions.facebook.thumbnail) {
        multiPlatformFormData.append('facebookThumbnail', uploadOptions.facebook.thumbnail);
      }

      multiPlatformFormData.append('options', JSON.stringify(uploadOptions));

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: multiPlatformFormData,
        });
        
        const contentType = response.headers.get("content-type");
        let data;
        if (contentType && contentType.indexOf("application/json") !== -1) {
          data = await response.json();
        } else {
          const text = await response.text();
          console.error(`Non-JSON response from server:`, text.substring(0, 500));
          throw new Error(`Server Error: ${text.substring(0, 100)}...`);
        }

        if (!response.ok) {
          let errorMessage = data.error || `Server Error: ${response.status}`;
          if (errorMessage.includes('authentication credentials') || errorMessage.includes('OAuth 2 access token')) {
            errorMessage = 'YouTube authentication expired. Please disconnect and reconnect your YouTube account.';
          }
          throw new Error(errorMessage);
        }
        
        const results = data.results || [];
        
        // Update statuses based on results
        results.forEach((result: any) => {
          const platform = result.platform;
          
          // If server returned new tokens (e.g. after refresh), update Firestore from client
          if (result.newTokens && platform === 'youtube') {
            console.log('Received new YouTube tokens, updating Firestore...');
            const userDocRef = doc(db, 'users', user.uid);
            updateDoc(userDocRef, {
              'tokens.youtube.access_token': result.newTokens.access_token,
              'tokens.youtube.expires_at': result.newTokens.expires_at
            }).catch(e => console.error('Failed to update tokens in Firestore:', e));
          }

          // Handle Instagram "processing" state
          if (result.status === 'processing' && platform === 'instagram') {
            setPlatformStatus(prev => ({ ...prev, [platform]: 'processing' }));
            // Start client-side polling for Instagram
            pollInstagramStatus(result.id, tokens.meta.access_token, result.igUserId);
          } else {
            setPlatformStatus(prev => ({ ...prev, [platform]: result.status }));
          }
        });

        finalResults.push(...results);
      } catch (err: any) {
        console.error(`Upload failed:`, err);
        platforms.forEach(p => {
          setPlatformStatus(prev => ({ ...prev, [p]: 'error' }));
        });
        throw err;
      }

      // Save overall record to history
      const overallStatus = finalResults.every(r => r.status === 'success') ? 'success' : 
                          finalResults.some(r => r.status === 'success') ? 'success' : 'error';
      
      await addDoc(collection(db, 'uploads'), {
        userId: user.uid,
        title,
        description,
        timestamp: Date.now(),
        status: overallStatus,
        results: finalResults,
        platforms: finalResults.filter(r => r.status === 'success').map(r => r.platform)
      });

      setUploadResults(finalResults);
      setNotification({ message: 'Publishing process completed', type: overallStatus === 'success' ? 'success' : 'error' });
      // Don't close modal immediately if there are results to show
      if (overallStatus === 'success' && finalResults.length === 1) {
        setIsUploadModalOpen(false);
        setUploadResults(null);
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setNotification({ message: err.message || 'Failed to publish video', type: 'error' });
    } finally {
      setLoading(false);
      setPlatformStatus({});
    }
  };

  const handleDelete = async () => {
    if (!user || !videoToDelete || deletePlatforms.length === 0) return;

    setIsDeleting(true);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const userDoc = await getDocFromServer(userDocRef);
      const tokens = userDoc.exists() ? (userDoc.data().tokens || {}) : {};

      const platformResults = videoToDelete.results?.filter(r => deletePlatforms.includes(r.platform)) || [];

      const response = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: videoToDelete.id,
          platformResults,
          tokens
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      const deleteResults = data.results || [];
      const failedDeletes = deleteResults.filter((r: any) => r.status === 'error');
      const successfulDeletes = deleteResults.filter((r: any) => r.status === 'success').map((r: any) => r.platform);

      if (failedDeletes.length > 0) {
        const errorMsgs = failedDeletes.map((f: any) => `${f.platform}: ${f.message}`).join('\n');
        setNotification({ 
          message: `Some deletions failed:\n${errorMsgs}`, 
          type: 'error' 
        });
      }

      if (successfulDeletes.length === 0 && failedDeletes.length > 0) {
        setIsDeleteModalOpen(false);
        setVideoToDelete(null);
        setDeletePlatforms([]);
        return;
      }

      // Update Firestore history
      const uploadDocRef = doc(db, 'uploads', videoToDelete.id);
      const updatedResults = videoToDelete.results?.map(r => {
        if (successfulDeletes.includes(r.platform)) {
          return { ...r, status: 'error', message: 'Deleted from platform' };
        }
        return r;
      }) || [];

      const stillActivePlatforms = updatedResults.filter(r => r.status === 'success').map(r => r.platform);
      
      if (stillActivePlatforms.length === 0) {
        await deleteDoc(uploadDocRef);
        if (failedDeletes.length === 0) {
          setNotification({ message: 'Video deleted from all platforms and removed from history', type: 'success' });
        }
      } else {
        await updateDoc(uploadDocRef, {
          results: updatedResults,
          platforms: stillActivePlatforms,
          status: 'success'
        });
        if (failedDeletes.length === 0) {
          setNotification({ message: 'Video deleted from selected platforms', type: 'success' });
        }
      }
      setIsDeleteModalOpen(false);
      setVideoToDelete(null);
      setDeletePlatforms([]);
    } catch (err: any) {
      console.error('Delete error:', err);
      setNotification({ message: 'Failed to delete video', type: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  const clearActivity = async () => {
    if (!user || isClearingHistory) return;
    
    setIsClearingHistory(true);
    try {
      const { writeBatch } = await import('firebase/firestore');
      const batch = writeBatch(db);
      
      history.forEach((item) => {
        const docRef = doc(db, 'uploads', item.id);
        batch.delete(docRef);
      });
      
      await batch.commit();
      setNotification({ message: 'Activity cleared successfully', type: 'success' });
      setIsConfirmingClear(false);
    } catch (err) {
      console.error('Error clearing activity:', err);
      setNotification({ message: 'Failed to clear activity', type: 'error' });
    } finally {
      setIsClearingHistory(false);
    }
  };
  const connectPlatform = async (provider: string) => {
    try {
      const response = await fetch(`/api/auth/${provider}/url`);
      const { url } = await response.json();
      
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      window.open(
        url,
        `Connect ${provider}`,
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (error) {
      console.error(`Failed to connect ${provider}:`, error);
    }
  };

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (!event.origin.includes(window.location.hostname) && !event.origin.includes('run.app')) return;
      
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && user) {
        console.log('OAuth Success received for provider:', event.data.provider);
        const { provider, tokens } = event.data;
        
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const fieldName = provider === 'google' ? 'youtube' : provider;
          
          console.log(`Saving token for ${fieldName}...`);
          
          // Use updateDoc with dot notation to ensure we only update the specific token
          await updateDoc(userDocRef, {
            [`tokens.${fieldName}`]: tokens
          });
          
          console.log(`Token for ${fieldName} saved to Firestore`);
          let platformName = 'Meta';
          if (provider === 'google') platformName = 'YouTube';
          if (provider === 'tiktok') platformName = 'TikTok';
          
          setNotification({ message: `${platformName} account connected successfully!`, type: 'success' });
          setError(null);
        } catch (error) {
          console.error('Error saving tokens:', error);
          // Fallback to setDoc if updateDoc fails (e.g. if doc doesn't exist yet)
          try {
            const userDocRef = doc(db, 'users', user.uid);
            const fieldName = provider === 'google' ? 'youtube' : provider;
            await setDoc(userDocRef, {
              tokens: {
                [fieldName]: tokens
              }
            }, { merge: true });
            
            let platformName = 'Meta';
            if (provider === 'google') platformName = 'YouTube';
            if (provider === 'tiktok') platformName = 'TikTok';
            
            setNotification({ message: `${platformName} account connected successfully!`, type: 'success' });
          } catch (fallbackErr) {
            const errInfo = handleFirestoreError(fallbackErr, OperationType.WRITE, `users/${user.uid}`);
            setError(errInfo.error);
          }
        }
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user]);

  const disconnectPlatform = async (platformId: string) => {
    if (!user) return;
    console.log('Disconnecting platform:', platformId);
    try {
      const userDocRef = doc(db, 'users', user.uid);
      
      const updates: any = {};
      if (platformId === 'google') {
        updates['tokens.youtube'] = deleteField();
      } else {
        // Aggressively clear all possible Meta-related keys
        updates['tokens.meta'] = deleteField();
        updates['tokens.instagram'] = deleteField();
        updates['tokens.facebook'] = deleteField();
      }
      
      console.log('Applying updates to Firestore:', updates);
      await updateDoc(userDocRef, updates);
      
      setNotification({ message: `Disconnected successfully`, type: 'success' });
    } catch (error) {
      console.error('Disconnect error:', error);
      setNotification({ message: 'Failed to disconnect', type: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
        <p className="text-slate-600 font-medium">Initializing OmniStream...</p>
        {initTimeout && (
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all"
          >
            Reload Page
          </button>
        )}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100"
        >
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-200">
            <Share2 className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">OmniStream</h1>
          <p className="text-slate-600 mb-8">Connect your social accounts and distribute content everywhere with one click.</p>
          
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200 text-slate-700 py-3 px-4 rounded-xl font-semibold hover:bg-slate-50 transition-all active:scale-95 shadow-sm"
          >
            <Image src="https://picsum.photos/seed/google/24/24" alt="Google" width={24} height={24} className="rounded-full" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-[100] max-w-md ${notification.type === 'success' ? 'bg-emerald-600 border-emerald-500' : 'bg-red-600 border-red-500'} text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border`}
          >
            {notification.type === 'success' ? <CheckCircle2 className="shrink-0" size={24} /> : <AlertCircle className="shrink-0" size={24} />}
            <div className="flex-1">
              <p className="font-bold text-sm">{notification.type === 'success' ? 'Success' : 'Error'}</p>
              <p className="text-xs opacity-90">{formatErrorMessage(notification.message)}</p>
            </div>
            <button onClick={() => setNotification(null)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </motion.div>
        )}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-24 right-4 z-[100] max-w-md bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-red-500"
          >
            <AlertCircle className="shrink-0" size={24} />
            <div className="flex-1">
              <p className="font-bold text-sm">Action Required</p>
              <p className="text-xs opacity-90">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
              <X size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-100">
            <Share2 className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-bold text-slate-900">OmniStream</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'connections', icon: Share2, label: 'Connections' },
            { id: 'workflows', icon: Settings, label: 'Workflows' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                activeTab === item.id 
                  ? 'bg-indigo-50 text-indigo-600 font-semibold' 
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl mb-3">
            {user.photoURL && (
              <Image src={user.photoURL} alt={user.displayName || ''} width={32} height={32} className="rounded-full" />
            )}
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-8">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              {activeTab === 'dashboard' ? 'Dashboard Overview' : 
               activeTab === 'connections' ? 'Connected Platforms' : 'Automation Workflows'}
            </h2>
            <p className="text-slate-500">Welcome back, {user.displayName?.split(' ')[0]}</p>
          </div>
          <button 
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95"
          >
            <Plus size={20} />
            New Post
          </button>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: 'Total Uploads', value: history.length, icon: Video, color: 'bg-blue-500' },
                { label: 'Active Platforms', value: accounts.length, icon: Share2, color: 'bg-purple-500' },
                { label: 'Success Rate', value: history.length > 0 ? `${Math.round((history.filter(h => h.status === 'success').length / history.length) * 100)}%` : '0%', icon: CheckCircle2, color: 'bg-emerald-500' },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className={`${stat.color} p-3 rounded-xl text-white shadow-lg`}>
                      <stat.icon size={24} />
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
                      <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-50 flex justify-between items-center">
                <h3 className="font-bold text-slate-900">Recent Activity</h3>
                {history.length > 0 && (
                  <div className="flex items-center gap-2">
                    {isConfirmingClear ? (
                      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-200">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Are you sure?</span>
                        <button 
                          onClick={clearActivity}
                          disabled={isClearingHistory}
                          className="text-xs font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                        >
                          Yes
                        </button>
                        <button 
                          onClick={() => setIsConfirmingClear(false)}
                          disabled={isClearingHistory}
                          className="text-xs font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setIsConfirmingClear(true)}
                        className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1"
                      >
                        <Trash2 size={12} />
                        Clear All
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="divide-y divide-slate-50">
                {history.length === 0 ? (
                  <div className="p-12 text-center">
                    <Video className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-500">No uploads yet. Start by creating a new post!</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-lg ${item.status === 'success' ? 'bg-emerald-50 text-emerald-600' : item.status === 'pending' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                          {item.status === 'success' ? <CheckCircle2 size={20} /> : item.status === 'pending' ? <Loader2 size={20} className="animate-spin" /> : <AlertCircle size={20} />}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900">{item.title}</p>
                          <p className="text-sm text-slate-500">{new Date(item.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex gap-2">
                          {item.results && item.results.length > 0 ? (
                            item.results.map(res => (
                              <div 
                                key={res.platform} 
                                title={res.status === 'error' ? res.message : 'Success'}
                                className={`p-1.5 rounded-md flex items-center gap-1.5 text-xs font-medium ${
                                  res.status === 'success' 
                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                                    : 'bg-red-50 text-red-600 border border-red-100'
                                }`}
                              >
                                {res.platform === 'youtube' ? <Youtube size={14} /> : res.platform === 'instagram' ? <Instagram size={14} /> : res.platform === 'tiktok' ? <Music size={14} /> : <Facebook size={14} />}
                                <span className="capitalize">{res.platform}</span>
                              </div>
                            ))
                          ) : (
                            item.platforms.map(p => (
                              <div key={p} className="p-1.5 bg-slate-100 rounded-md text-slate-600 border border-slate-200">
                                {p === 'youtube' ? <Youtube size={14} /> : p === 'instagram' ? <Instagram size={14} /> : p === 'tiktok' ? <Music size={14} /> : <Facebook size={14} />}
                              </div>
                            ))
                          )}
                        </div>
                        {item.status === 'error' && (
                          <p className="text-[10px] text-red-500 font-medium max-w-[200px] text-right truncate" title={formatErrorMessage(item.message || (item.results?.find(r => r.status === 'error')?.message) || 'Upload failed')}>
                            {formatErrorMessage(item.message || (item.results?.find(r => r.status === 'error')?.message) || 'Upload failed')}
                          </p>
                        )}
                        {item.status === 'success' && (
                          <button 
                            onClick={() => {
                              setVideoToDelete(item);
                              setDeletePlatforms(item.results?.filter(r => r.status === 'success').map(r => r.platform) || []);
                              setIsDeleteModalOpen(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                            title="Delete from platforms"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'connections' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { id: 'google', platform: 'youtube', name: 'YouTube', icon: Youtube, color: 'text-red-600', bg: 'bg-red-50' },
              { id: 'meta', platform: 'meta', name: 'Instagram', icon: Instagram, color: 'text-pink-600', bg: 'bg-pink-50' },
              { id: 'meta', platform: 'meta', name: 'Facebook', icon: Facebook, color: 'text-blue-600', bg: 'bg-blue-50' },
              { id: 'tiktok', platform: 'tiktok', name: 'TikTok', icon: Music, color: 'text-black', bg: 'bg-slate-100' },
            ].map((platform) => {
              const account = accounts.find(a => a.id === platform.id);
              const isConnected = !!account;
              
              return (
                <div key={platform.name} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col">
                  <div className="flex items-center justify-between mb-6">
                    <div className={`${platform.bg} ${platform.color} p-3 rounded-xl`}>
                      <platform.icon size={24} />
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${isConnected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                      {isConnected ? 'CONNECTED' : 'NOT CONNECTED'}
                    </div>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-1">{platform.name}</h3>
                  
                  <div className="flex-1">
                    {isConnected ? (
                      <div className="bg-slate-50 rounded-xl p-3 mb-6 border border-slate-100">
                        {platform.platform === 'youtube' && account.accountName && (
                          <div className="flex items-center gap-3">
                            {account.profilePicture && (
                              <Image src={account.profilePicture} alt={account.accountName} width={32} height={32} className="rounded-full border border-slate-200" />
                            )}
                            <div className="overflow-hidden">
                              <p className="text-sm font-bold text-slate-900 truncate">{account.accountName}</p>
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Channel</p>
                            </div>
                          </div>
                        )}

                        {platform.platform === 'tiktok' && account.accountName && (
                          <div className="flex items-center gap-3">
                            {account.profilePicture && (
                              <Image src={account.profilePicture} alt={account.accountName} width={32} height={32} className="rounded-full border border-slate-200" />
                            )}
                            <div className="overflow-hidden">
                              <p className="text-sm font-bold text-slate-900 truncate">{account.accountName}</p>
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Account</p>
                            </div>
                          </div>
                        )}
                        
                        {platform.name === 'Facebook' && account.pages && (
                          <div className="space-y-2">
                            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Connected Pages</p>
                            {account.pages.slice(0, 2).map(page => (
                              <div key={page.id} className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                <p className="text-xs font-semibold text-slate-700 truncate">{page.name}</p>
                              </div>
                            ))}
                            {account.pages.length > 2 && <p className="text-[10px] text-slate-400">+{account.pages.length - 2} more</p>}
                          </div>
                        )}

                        {platform.name === 'Instagram' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Connected Accounts</p>
                              <button 
                                onClick={refreshMetaAccounts}
                                disabled={isRefreshingMeta}
                                className="text-[10px] text-indigo-600 font-bold hover:underline flex items-center gap-1 disabled:opacity-50"
                              >
                                <RefreshCw className={`w-2.5 h-2.5 ${isRefreshingMeta ? 'animate-spin' : ''}`} />
                                REFRESH
                              </button>
                            </div>
                            {account.instagramAccounts && account.instagramAccounts.length > 0 ? (
                              <>
                                {account.instagramAccounts.slice(0, 2).map(ig => (
                                  <div key={ig.id} className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                      <div className="w-1.5 h-1.5 rounded-full bg-pink-500 shrink-0" />
                                      <p className="text-xs font-semibold text-slate-700 truncate">@{ig.username}</p>
                                    </div>
                                    {(ig as any).account_type && (
                                      <span className={`text-[8px] px-1 py-0.5 rounded font-bold uppercase shrink-0 ${(ig as any).account_type === 'PERSONAL' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                        {(ig as any).account_type}
                                      </span>
                                    )}
                                  </div>
                                ))}
                                {account.instagramAccounts.length > 2 && <p className="text-[10px] text-slate-400">+{account.instagramAccounts.length - 2} more</p>}
                              </>
                            ) : (
                              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 space-y-2">
                                <p className="text-[10px] text-amber-800 leading-tight font-bold">
                                  No Instagram Business accounts found.
                                </p>
                                <div className="space-y-1.5">
                                  <p className="text-[9px] text-amber-700">
                                    1. Verify your Instagram is linked to a <a href="https://www.facebook.com/settings?tab=linked_accounts" target="_blank" className="underline font-bold">Facebook Page</a>.
                                  </p>
                                  <p className="text-[9px] text-amber-700">
                                    2. Click <span className="font-bold">Reconnect</span> below.
                                  </p>
                                  <p className="text-[9px] text-amber-700">
                                    3. In the Facebook popup, click <span className="font-bold text-indigo-600">"Edit Settings"</span>.
                                  </p>
                                  <p className="text-[9px] text-amber-700">
                                    4. <span className="font-bold underline">IMPORTANT:</span> You must manually check the box for <span className="font-bold">EVERY</span> Page and Instagram account you want to use.
                                  </p>
                                </div>
                                {account.pages && account.pages.length > 0 && (
                                  <div className="pt-2 border-t border-amber-200 mt-2 space-y-2">
                                    <p className="text-[8px] text-amber-600 uppercase font-bold">Diagnostic: Found {account.pages.length} Pages</p>
                                    <div className="space-y-1.5">
                                      {account.pages.map(p => (
                                        <div key={p.id} className="bg-amber-100/50 p-1.5 rounded border border-amber-200/50">
                                          <p className="text-[9px] font-bold text-amber-800">{p.name}</p>
                                          {(p as any).igError && (
                                            <p className="text-[8px] text-red-600 leading-tight mt-0.5">
                                              Error: {(p as any).igError}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {account.rawPermissions && (
                              <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Diagnostic Permissions</p>
                                <div className="flex flex-wrap gap-1">
                                  {account.rawPermissions.map((p: any) => (
                                    <span key={p.permission} className={`text-[9px] px-1.5 py-0.5 rounded-md border ${p.status === 'granted' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                      {p.permission}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {!account.accountName && !account.pages && !account.instagramAccounts && (
                          <p className="text-xs text-slate-500 italic">Account details loading...</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500 mb-6">Distribute your videos to {platform.name} automatically.</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => isConnected ? disconnectPlatform(platform.id) : connectPlatform(platform.id)}
                      className={`flex-1 py-2.5 rounded-xl font-semibold transition-all ${
                        isConnected 
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' 
                          : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
                      }`}
                    >
                      {isConnected ? 'Disconnect' : `Connect`}
                    </button>
                    {isConnected && (
                      <button 
                        onClick={() => connectPlatform(platform.id)}
                        className="px-4 py-2.5 bg-indigo-50 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-100 transition-all"
                        title="Reconnect to refresh tokens"
                      >
                        Reconnect
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <AnimatePresence>
        {isDeleteModalOpen && videoToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-slate-900">Delete Video</h3>
                  <button 
                    onClick={() => setIsDeleteModalOpen(false)}
                    disabled={isDeleting}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors disabled:opacity-50"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="mb-6">
                  <p className="text-slate-600 mb-4">
                    Select the platforms you want to delete <span className="font-bold text-slate-900">"{videoToDelete.title}"</span> from:
                  </p>
                  <div className="space-y-3">
                    {videoToDelete.results?.filter(r => r.status === 'success').map(res => (
                      <label key={res.platform} className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 hover:bg-slate-50 transition-all cursor-pointer">
                        <div className="flex items-center gap-3">
                          {res.platform === 'youtube' ? <Youtube className="text-red-600" size={20} /> : res.platform === 'instagram' ? <Instagram className="text-pink-600" size={20} /> : <Facebook className="text-blue-600" size={20} />}
                          <span className="font-bold text-slate-700 capitalize">{res.platform}</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={deletePlatforms.includes(res.platform)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDeletePlatforms([...deletePlatforms, res.platform]);
                            } else {
                              setDeletePlatforms(deletePlatforms.filter(p => p !== res.platform));
                            }
                          }}
                          className="w-5 h-5 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-8">
                  <div className="flex gap-3">
                    <AlertCircle className="text-amber-600 shrink-0" size={20} />
                    <p className="text-xs text-amber-800 leading-relaxed">
                      <span className="font-bold">Note:</span> Deletion from Instagram may not be supported for all content types via the API. You may need to delete it manually from the Instagram app.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsDeleteModalOpen(false)}
                    disabled={isDeleting}
                    className="flex-1 px-6 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleDelete}
                    disabled={isDeleting || deletePlatforms.length === 0}
                    className="flex-1 bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-200 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      'Confirm Delete'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsUploadModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center shrink-0">
                <h3 className="text-xl font-bold text-slate-900">
                  {uploadResults ? 'Publishing Results' : 'Create New Post'}
                </h3>
                <button onClick={() => {
                  setIsUploadModalOpen(false);
                  setUploadResults(null);
                }} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>

              {uploadResults ? (
                <div className="p-8 flex-1 overflow-y-auto">
                  <div className="space-y-6">
                    <div className="text-center mb-8">
                      <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4 ${
                        uploadResults.every(r => r.status === 'success') ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
                      }`}>
                        {uploadResults.every(r => r.status === 'success') ? <CheckCircle2 size={32} /> : <AlertCircle size={32} />}
                      </div>
                      <h4 className="text-xl font-bold text-slate-900">
                        {uploadResults.every(r => r.status === 'success') ? 'All Published Successfully!' : 'Publishing Complete with Warnings'}
                      </h4>
                      <p className="text-slate-500 mt-2">Here is the status of your video across selected platforms.</p>
                    </div>

                    <div className="space-y-3">
                      {uploadResults.map((res) => (
                        <div key={res.platform} className={`p-4 rounded-2xl border flex items-center justify-between ${
                          res.status === 'success' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-red-50/50 border-red-100'
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${
                              res.platform === 'youtube' ? 'bg-red-100 text-red-600' : 
                              res.platform === 'instagram' ? 'bg-pink-100 text-pink-600' : 
                              res.platform === 'tiktok' ? 'bg-slate-100 text-black' : 'bg-blue-100 text-blue-600'
                            }`}>
                              {res.platform === 'youtube' ? <Youtube size={20} /> : res.platform === 'instagram' ? <Instagram size={20} /> : res.platform === 'tiktok' ? <Music size={20} /> : <Facebook size={20} />}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 capitalize">{res.platform}</p>
                              <div className="flex items-center gap-2">
                                <p className={`text-xs font-medium ${
                                  res.status === 'success' ? 'text-emerald-600' : 
                                  res.status === 'error' ? 'text-red-600' : 'text-indigo-600'
                                }`}>
                                  {res.status === 'success' ? 'Published successfully' : 
                                   res.status === 'error' ? 'Failed to publish' : 
                                   res.status === 'processing' ? 'Processing on Instagram...' : 'Uploading...'}
                                </p>
                                {(res.status === 'processing' || res.status === 'uploading') && (
                                  <Loader2 size={12} className="animate-spin text-indigo-600" />
                                )}
                              </div>
                            </div>
                          </div>
                          {res.status === 'error' && (
                            <div className="max-w-[250px] text-right">
                              <p className="text-[11px] text-red-500 font-bold leading-tight">{formatErrorMessage(res.message || '')}</p>
                            </div>
                          )}
                          {res.status === 'processing' && (
                            <div className="max-w-[250px] text-right">
                              <p className="text-[10px] text-indigo-500 italic leading-tight">
                                Meta is processing the video. This can take a few minutes.
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <button 
                      onClick={() => {
                        setIsUploadModalOpen(false);
                        setUploadResults(null);
                      }}
                      className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold text-lg hover:bg-slate-800 transition-all mt-8"
                    >
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <form className="flex flex-col overflow-hidden" onSubmit={handleUpload}>
                  <div className="p-8 space-y-6 overflow-y-auto flex-1">
                    {/* Tabs */}
                    <div className="flex border-b border-slate-100 mb-6 sticky top-0 bg-white z-10">
                      {[
                        { id: 'general', label: 'Global Settings', icon: LayoutDashboard },
                        { id: 'youtube', label: 'YouTube', icon: Youtube, platform: 'youtube' },
                        { id: 'instagram', label: 'Instagram', icon: Instagram, platform: 'instagram' },
                        { id: 'facebook', label: 'Facebook', icon: Facebook, platform: 'facebook' },
                        { id: 'tiktok', label: 'TikTok', icon: Music, platform: 'tiktok' },
                      ].map((tab) => {
                        const isConnected = !tab.platform || (
                          tab.platform === 'youtube' 
                            ? accounts.some(a => a.platform === 'youtube')
                            : tab.platform === 'tiktok'
                            ? accounts.some(a => a.platform === 'tiktok')
                            : accounts.some(a => a.id === 'meta')
                        );
                        
                        if (!isConnected && tab.id !== 'general') return null;

                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveUploadTab(tab.id as any)}
                            className={`px-4 py-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 ${
                              activeUploadTab === tab.id 
                                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50' 
                                : 'border-transparent text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            <tab.icon size={14} />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {activeUploadTab === 'general' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                          <p className="text-xs text-indigo-700 leading-relaxed">
                            <span className="font-bold">Global Settings:</span> Upload your video here and set the default title/description. You can override these in the platform-specific tabs.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Video File</label>
                          <div className="relative border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-indigo-400 transition-colors cursor-pointer group">
                            <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:bg-indigo-50 transition-colors">
                              <Upload className="text-slate-400 group-hover:text-indigo-600" />
                            </div>
                            <p className="text-slate-600 font-medium">{uploadData.video ? uploadData.video.name : 'Click to upload or drag and drop'}</p>
                            <p className="text-xs text-slate-400 mt-1">MP4, MOV, or AVI (Max 500MB)</p>
                            <input type="file" className="hidden" accept="video/*" id="video-upload" onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setUploadData(prev => ({ ...prev, video: file }));
                              }
                            }} />
                            <label htmlFor="video-upload" className="absolute inset-0 cursor-pointer" />
                            {uploadData.video && (
                              <button 
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setUploadData(prev => ({ ...prev, video: null }));
                                }}
                                className="absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm hover:bg-red-50 text-red-500 transition-colors z-10"
                              >
                                <X size={16} />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Global Title</label>
                            <input 
                              value={uploadData.title}
                              onChange={(e) => setUploadData(prev => ({ ...prev, title: e.target.value }))}
                              type="text" 
                              required
                              placeholder="Enter default title"
                              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Platforms</label>
                            <div className="flex gap-2">
                              {['youtube', 'instagram', 'facebook', 'tiktok'].map(p => {
                                const isConnected = p === 'youtube' 
                                  ? accounts.some(a => a.platform === 'youtube')
                                  : p === 'tiktok'
                                  ? accounts.some(a => a.platform === 'tiktok')
                                  : accounts.some(a => a.id === 'meta');
                                
                                return (
                                  <label key={p} className={`flex-1 relative ${!isConnected ? 'opacity-40 grayscale cursor-not-allowed' : ''}`}>
                                    <input 
                                      type="checkbox" 
                                      checked={uploadData.platforms.includes(p)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setUploadData(prev => ({ ...prev, platforms: [...prev.platforms, p] }));
                                        } else {
                                          setUploadData(prev => ({ ...prev, platforms: prev.platforms.filter(plat => plat !== p) }));
                                        }
                                      }}
                                      className="hidden peer" 
                                      disabled={loading || !isConnected} 
                                    />
                                    <div className={`p-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center cursor-pointer peer-checked:bg-indigo-50 peer-checked:border-indigo-500 peer-checked:text-indigo-600 ${platformStatus[p] === 'uploading' || platformStatus[p] === 'processing' ? 'animate-pulse border-indigo-500 bg-indigo-50' : ''} ${platformStatus[p] === 'success' ? 'border-emerald-500 bg-emerald-50 text-emerald-600' : ''} ${platformStatus[p] === 'error' ? 'border-red-500 bg-red-50 text-red-600' : ''}`}>
                                      {platformStatus[p] === 'uploading' || platformStatus[p] === 'processing' ? (
                                        <Loader2 size={20} className="animate-spin" />
                                      ) : platformStatus[p] === 'success' ? (
                                        <CheckCircle2 size={20} />
                                      ) : platformStatus[p] === 'error' ? (
                                        <AlertCircle size={20} />
                                      ) : (
                                        p === 'youtube' ? <Youtube size={20} /> : p === 'instagram' ? <Instagram size={20} /> : p === 'tiktok' ? <Music size={20} /> : <Facebook size={20} />
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Global Description</label>
                          <textarea 
                            value={uploadData.description}
                            onChange={(e) => setUploadData(prev => ({ ...prev, description: e.target.value }))}
                            rows={3}
                            placeholder="Tell your audience about this video..."
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
                          />
                        </div>
                      </div>
                    )}

                    {activeUploadTab === 'tiktok' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <p className="text-xs text-slate-600 leading-relaxed">
                            <span className="font-bold">TikTok Settings:</span> Customize how your video appears on TikTok.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">TikTok Caption</label>
                          <textarea 
                            value={uploadOptions.tiktok.title}
                            onChange={(e) => setUploadOptions(prev => ({ ...prev, tiktok: { ...prev.tiktok, title: e.target.value } }))}
                            rows={3}
                            placeholder="Enter TikTok caption..."
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-sm font-bold text-slate-700">Allow Comments</span>
                            <button 
                              type="button"
                              onClick={() => setUploadOptions(prev => ({ ...prev, tiktok: { ...prev.tiktok, allow_comments: !prev.tiktok.allow_comments } }))}
                              className={`w-12 h-6 rounded-full transition-all relative ${uploadOptions.tiktok.allow_comments ? 'bg-indigo-600' : 'bg-slate-300'}`}
                            >
                              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${uploadOptions.tiktok.allow_comments ? 'left-7' : 'left-1'}`} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-sm font-bold text-slate-700">Allow Duet</span>
                            <button 
                              type="button"
                              onClick={() => setUploadOptions(prev => ({ ...prev, tiktok: { ...prev.tiktok, allow_duet: !prev.tiktok.allow_duet } }))}
                              className={`w-12 h-6 rounded-full transition-all relative ${uploadOptions.tiktok.allow_duet ? 'bg-indigo-600' : 'bg-slate-300'}`}
                            >
                              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${uploadOptions.tiktok.allow_duet ? 'left-7' : 'left-1'}`} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-sm font-bold text-slate-700">Allow Stitch</span>
                            <button 
                              type="button"
                              onClick={() => setUploadOptions(prev => ({ ...prev, tiktok: { ...prev.tiktok, allow_stitch: !prev.tiktok.allow_stitch } }))}
                              className={`w-12 h-6 rounded-full transition-all relative ${uploadOptions.tiktok.allow_stitch ? 'bg-indigo-600' : 'bg-slate-300'}`}
                            >
                              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${uploadOptions.tiktok.allow_stitch ? 'left-7' : 'left-1'}`} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    {activeUploadTab === 'youtube' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">YouTube Specific Title (Optional)</label>
                          <input 
                            type="text"
                            value={uploadOptions.youtube.title}
                            onChange={(e) => setUploadOptions({ ...uploadOptions, youtube: { ...uploadOptions.youtube, title: e.target.value } })}
                            placeholder={uploadData.title || "Enter YouTube specific title"}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Privacy Status</label>
                            <select 
                              value={uploadOptions.youtube.privacy}
                              onChange={(e) => setUploadOptions({ ...uploadOptions, youtube: { ...uploadOptions.youtube, privacy: e.target.value } })}
                              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            >
                              <option value="public">Public</option>
                              <option value="unlisted">Unlisted</option>
                              <option value="private">Private</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Category</label>
                            <select 
                              value={uploadOptions.youtube.category}
                              onChange={(e) => setUploadOptions({ ...uploadOptions, youtube: { ...uploadOptions.youtube, category: e.target.value } })}
                              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                            >
                              <option value="22">People & Blogs</option>
                              <option value="20">Gaming</option>
                              <option value="10">Music</option>
                              <option value="24">Entertainment</option>
                              <option value="28">Science & Technology</option>
                            </select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Tags (comma separated)</label>
                          <input 
                            type="text"
                            value={uploadOptions.youtube.tags}
                            onChange={(e) => setUploadOptions({ ...uploadOptions, youtube: { ...uploadOptions.youtube, tags: e.target.value } })}
                            placeholder="vlog, tech, tutorial..."
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Thumbnail (Optional)</label>
                          <input 
                            type="file"
                            accept="image/*"
                            className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                          />
                        </div>
                        <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                          <p className="text-xs text-indigo-700 leading-relaxed">
                            <span className="font-bold">Tip:</span> YouTube automatically detects vertical videos under 60 seconds as <span className="font-bold">Shorts</span>.
                          </p>
                        </div>
                      </div>
                    )}

                    {activeUploadTab === 'instagram' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {accounts.find(a => a.platform === 'meta')?.hasInstagramPublishPermission === false && (
                          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <p className="text-sm font-bold text-amber-800">Missing Permissions</p>
                              <p className="text-xs text-amber-700 leading-relaxed">
                                You haven't granted permission to publish content to Instagram. 
                                <br /><br />
                                <span className="font-bold">To fix this:</span>
                                <ol className="list-decimal ml-4 mt-1 space-y-1">
                                  <li>Go to the <span className="font-bold">Accounts</span> tab.</li>
                                  <li>Click <span className="font-bold">Reconnect</span> for Meta.</li>
                                  <li>In the Facebook popup, click <span className="font-bold">Edit Settings</span>.</li>
                                  <li>Ensure <span className="font-bold">ALL</span> Instagram accounts and <span className="font-bold">ALL</span> Pages are selected. <span className="text-amber-900 font-medium">(Note: This only grants access; you will still choose the specific destination account when you upload.)</span></li>
                                  <li>Grant all requested permissions.</li>
                                </ol>
                              </p>
                            </div>
                          </div>
                        )}
                        {accounts.find(a => a.platform === 'meta')?.instagramAccounts && (
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Select Instagram Account</label>
                            <select 
                              value={uploadOptions.instagram.instagramAccountId}
                              onChange={(e) => setUploadOptions({ ...uploadOptions, instagram: { ...uploadOptions.instagram, instagramAccountId: e.target.value } })}
                              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                            >
                              <option value="">Default (First found)</option>
                              {accounts.find(a => a.platform === 'meta')?.instagramAccounts?.map(acc => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.name} (@{acc.username}) {acc.account_type ? `[${acc.account_type}]` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Instagram Specific Title (Optional)</label>
                          <input 
                            type="text"
                            value={uploadOptions.instagram.title}
                            onChange={(e) => setUploadOptions({ ...uploadOptions, instagram: { ...uploadOptions.instagram, title: e.target.value } })}
                            placeholder={uploadData.title || "Enter Instagram specific title"}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Instagram Specific Caption</label>
                          {/* Instagram Thumbnail/Cover */}
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cover Image (Optional)</label>
                            <div className="flex items-center gap-4">
                              <div className="relative w-24 h-24 bg-slate-100 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden group">
                                {uploadOptions.instagram.thumbnail ? (
                                  <>
                                    <img 
                                      src={URL.createObjectURL(uploadOptions.instagram.thumbnail)} 
                                      alt="Cover" 
                                      className="w-full h-full object-cover"
                                    />
                                    <button 
                                      onClick={() => setUploadOptions({ ...uploadOptions, instagram: { ...uploadOptions.instagram, thumbnail: null } })}
                                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                                    >
                                      <X className="w-5 h-5" />
                                    </button>
                                  </>
                                ) : (
                                  <label className="cursor-pointer flex flex-col items-center">
                                    <ImageIcon className="w-6 h-6 text-slate-300" />
                                    <input 
                                      type="file" 
                                      accept="image/*" 
                                      className="hidden" 
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) setUploadOptions({ ...uploadOptions, instagram: { ...uploadOptions.instagram, thumbnail: file } });
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                              <div className="flex-1">
                                <p className="text-[10px] text-slate-500 leading-relaxed">
                                  Select a custom cover for your Reel. Recommended size: 1080x1920px.
                                </p>
                              </div>
                            </div>
                          </div>

                          <textarea 
                            value={uploadOptions.instagram.caption}
                            onChange={(e) => setUploadOptions({ ...uploadOptions, instagram: { ...uploadOptions.instagram, caption: e.target.value } })}
                            rows={4}
                            placeholder="Add hashtags and mentions for Instagram..."
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none"
                          />
                          
                          {/* Official Hashtag Search Tool */}
                          <div className="mt-2 space-y-2">
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <input 
                                  type="text"
                                  value={tagSearchQuery}
                                  onChange={(e) => setTagSearchQuery(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      checkHashtag(tagSearchQuery);
                                    }
                                  }}
                                  placeholder="Search exact hashtag (e.g. #nature)"
                                  className="w-full px-4 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500 transition-all"
                                />
                                {isSearchingTag && (
                                  <div className="absolute right-3 top-2.5">
                                    <Loader2 className="w-4 h-4 text-pink-500 animate-spin" />
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => checkHashtag(tagSearchQuery)}
                                disabled={isSearchingTag || !tagSearchQuery}
                                className="px-4 py-2 bg-pink-50 text-pink-600 text-sm font-bold rounded-lg hover:bg-pink-100 transition-all disabled:opacity-50"
                              >
                                Search
                              </button>
                            </div>
                            
                            {tagResult && (
                              <div className="flex flex-col space-y-2">
                                <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-pink-100 shadow-sm animate-in fade-in slide-in-from-top-1">
                                  <div className="flex flex-col">
                                    <span className="text-sm font-bold text-slate-800">#{tagResult.name}</span>
                                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                                      {tagResult.media_count > 0 ? `${tagResult.media_count.toLocaleString()} posts` : 'Post count hidden'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const currentCaption = uploadOptions.instagram.caption;
                                      const tagName = `#${tagResult.name}`;
                                      if (currentCaption.includes(tagName)) return;
                                      const newCaption = currentCaption ? `${currentCaption} ${tagName}` : tagName;
                                      setUploadOptions({ ...uploadOptions, instagram: { ...uploadOptions.instagram, caption: newCaption } });
                                    }}
                                    className="px-3 py-1 bg-pink-600 text-white text-[10px] font-bold rounded-lg hover:bg-pink-700 transition-all"
                                  >
                                    Add to Caption
                                  </button>
                                </div>
                                {tagResult.media_count === 0 && (
                                  <p className="text-[10px] text-pink-600 bg-pink-50 p-2 rounded-lg">
                                    Tip: If post counts show as 0, try <strong>reconnecting</strong> your Meta account in Global Settings to refresh permissions.
                                  </p>
                                )}
                              </div>
                            )}
                            
                            <p className="text-[9px] text-slate-400 italic leading-tight">
                              Note: The official Instagram API only supports exact matches and has a limit of 30 searches per week.
                            </p>
                          </div>
                        </div>
                        <div className="p-4 bg-pink-50 rounded-2xl border border-pink-100">
                          <p className="text-xs text-pink-700 leading-relaxed">
                            <span className="font-bold">Note:</span> All videos uploaded via the API are published as <span className="font-bold">Reels</span>.
                          </p>
                        </div>
                      </div>
                    )}

                    {activeUploadTab === 'facebook' && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {accounts.find(a => a.platform === 'meta')?.pages && (
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Select Facebook Page</label>
                            <select 
                              value={uploadOptions.facebook.pageId}
                              onChange={(e) => setUploadOptions({ ...uploadOptions, facebook: { ...uploadOptions.facebook, pageId: e.target.value } })}
                              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                            >
                              <option value="">Default (First found)</option>
                              {accounts.find(a => a.platform === 'meta')?.pages?.map(page => (
                                <option key={page.id} value={page.id}>{page.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Facebook Specific Title (Optional)</label>
                          <input 
                            type="text"
                            value={uploadOptions.facebook.title}
                            onChange={(e) => setUploadOptions({ ...uploadOptions, facebook: { ...uploadOptions.facebook, title: e.target.value } })}
                            placeholder={uploadData.title || "Enter Facebook specific title"}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        </div>

                        {/* Facebook Thumbnail/Cover */}
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Video Thumbnail (Optional)</label>
                          <div className="flex items-center gap-4">
                            <div className="relative w-24 h-24 bg-slate-100 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden group">
                              {uploadOptions.facebook.thumbnail ? (
                                <>
                                  <img 
                                    src={URL.createObjectURL(uploadOptions.facebook.thumbnail)} 
                                    alt="Thumbnail" 
                                    className="w-full h-full object-cover"
                                  />
                                  <button 
                                    type="button"
                                    onClick={() => setUploadOptions({ ...uploadOptions, facebook: { ...uploadOptions.facebook, thumbnail: null } })}
                                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                                  >
                                    <X className="w-5 h-5" />
                                  </button>
                                </>
                              ) : (
                                <label className="cursor-pointer flex flex-col items-center">
                                  <ImageIcon className="w-6 h-6 text-slate-300" />
                                  <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) setUploadOptions({ ...uploadOptions, facebook: { ...uploadOptions.facebook, thumbnail: file } });
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] text-slate-500 leading-relaxed">
                                Select a custom thumbnail for your Facebook video.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Post Privacy</label>
                          <select 
                            value={uploadOptions.facebook.privacy}
                            onChange={(e) => setUploadOptions({ ...uploadOptions, facebook: { ...uploadOptions.facebook, privacy: e.target.value } })}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          >
                            <option value="EVERYONE">Public</option>
                            <option value="ALL_FRIENDS">Friends</option>
                            <option value="SELF">Only Me</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Selected Accounts Summary */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-3">Publishing To:</p>
                      <div className="space-y-3">
                        {uploadData.platforms.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">No platforms selected. Go to Global Settings to select where to publish.</p>
                        ) : (
                          <>
                            {uploadData.platforms.includes('youtube') && (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Youtube size={16} className="text-red-600" />
                                  <span className="text-xs font-bold text-slate-700">YouTube</span>
                                </div>
                                <span className="text-xs text-slate-500 font-medium">{accounts.find(a => a.platform === 'youtube')?.accountName || 'Connected Channel'}</span>
                              </div>
                            )}
                            {uploadData.platforms.includes('facebook') && (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Facebook size={16} className="text-blue-600" />
                                  <span className="text-xs font-bold text-slate-700">Facebook</span>
                                </div>
                                <span className="text-xs text-slate-500 font-medium">
                                  {accounts.find(a => a.id === 'meta')?.pages?.[0]?.name || 'Connected Page'}
                                </span>
                              </div>
                            )}
                            {uploadData.platforms.includes('instagram') && (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Instagram size={16} className="text-pink-600" />
                                  <span className="text-xs font-bold text-slate-700">Instagram</span>
                                </div>
                                <span className="text-xs text-slate-500 font-medium">
                                  {accounts.find(a => a.id === 'meta')?.instagramAccounts?.[0]?.username ? `@${accounts.find(a => a.id === 'meta')?.instagramAccounts?.[0]?.username}` : 'Connected Account'}
                                </span>
                              </div>
                            )}
                            {uploadData.platforms.includes('tiktok') && (
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Music size={16} className="text-slate-900" />
                                  <span className="text-xs font-bold text-slate-700">TikTok</span>
                                </div>
                                <span className="text-xs text-slate-500 font-medium">
                                  {accounts.find(a => a.platform === 'tiktok')?.accountName || 'Connected Account'}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-8 bg-white border-t border-slate-100 shrink-0">
                    <button 
                      type="submit"
                      disabled={loading}
                      className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        Object.values(platformStatus).some(s => s === 'uploading') ? (
                          <>
                            <Loader2 size={20} className="animate-spin" />
                            Publishing to {Object.entries(platformStatus).find(([_, s]) => s === 'uploading')?.[0]}...
                          </>
                        ) : (
                          <>
                            <Loader2 size={20} className="animate-spin" />
                            Processing...
                          </>
                        )
                      ) : (
                        'Publish Everywhere'
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>

          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
