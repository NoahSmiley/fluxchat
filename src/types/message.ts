// Message-related types: messages, attachments, reactions, DMs, pagination

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  domain?: string;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  createdAt: string;
  editedAt?: string;
  attachments?: Attachment[];
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface DMMessage {
  id: string;
  dmChannelId: string;
  senderId: string;
  ciphertext: string;
  mlsEpoch: number;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}
