// ── Base helpers (kept here for backwards compatibility) ──
export { getStoredToken, request } from "./api-base.js";

// ── Domain re-exports ──
export {
  signUp,
  signIn,
  signOut,
  getSession,
  updateUserProfile,
  setPublicKey,
  getPublicKey,
  storeServerKey,
  getMyServerKey,
  shareServerKeyWith,
} from "./api-auth.js";

export {
  getServers,
  updateServer,
  leaveServer,
  getServerMembers,
  updateMemberRole,
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  getChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  createRoom,
  acceptKnock,
  inviteToRoom,
  moveUserToRoom,
  reorderChannels,
  getCustomEmojis,
  createCustomEmoji,
  deleteCustomEmoji,
  getEmojiFavorites,
  addStandardFavorite,
  removeStandardFavorite,
  addCustomFavorite,
  removeCustomFavorite,
} from "./api-servers.js";

export {
  getMessages,
  searchServerMessages,
  getReactions,
  getDMChannels,
  createDM,
  getDMMessages,
  searchDMMessages,
  uploadFile,
  getFileUrl,
  getLinkPreview,
} from "./api-messages.js";

export {
  getVoiceToken,
} from "./api-voice.js";

export {
  getSpotifyAuthInfo,
  initSpotifyAuth,
  getSpotifyToken,
  unlinkSpotify,
  searchSpotifyTracks,
  createListeningSession,
  getListeningSession,
  addToQueue,
  removeFromQueue,
  deleteListeningSession,
  searchYouTubeTracks,
  getYouTubeAudioUrl,
} from "./api-spotify.js";

export {
  getSoundboardSounds,
  createSoundboardSound,
  updateSoundboardSound,
  deleteSoundboardSound,
  favoriteSoundboardSound,
  unfavoriteSoundboardSound,
} from "./api-soundboard.js";
