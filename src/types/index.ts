export interface SocialAccount {
  id: string;
  platform: 'youtube' | 'instagram' | 'facebook' | 'meta';
  name: string;
  connected: boolean;
  tokens?: any;
  accountName?: string;
  profilePicture?: string;
  pages?: { id: string, name: string }[];
  instagramAccounts?: { id: string, username: string, name: string }[];
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
