export interface SocialAccount {
  id: string;
  platform: 'youtube' | 'instagram' | 'facebook' | 'meta' | 'tiktok';
  name: string;
  connected: boolean;
  tokens?: any;
  accountName?: string;
  profilePicture?: string;
  pages?: { id: string, name: string }[];
  instagramAccounts?: { id: string, username: string, name: string, account_type?: string }[];
  hasInstagramPublishPermission?: boolean;
  rawPermissions?: { permission: string, status: string }[];
}

export interface UploadResult {
  id: string;
  title: string;
  timestamp: number;
  platforms: string[];
  status: 'pending' | 'success' | 'error';
  message?: string;
  link?: string;
  results?: {
    platform: string;
    status: 'success' | 'error';
    message?: string;
    link?: string;
  }[];
}
