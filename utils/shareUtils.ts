/**
 * Video Sharing Utilities
 * Provides an abstraction layer for sharing and saving videos.
 */

export type ShareTarget = 'system' | 'tiktok' | 'instagram' | 'youtube';

export interface ShareResult {
    success: boolean;
    method: 'native' | 'fallback';
    error?: string;
}

/**
 * Shares a video file using the Web Share API or falls back to download.
 */
export const shareVideo = async (
    file: File,
    target: ShareTarget = 'system'
): Promise<ShareResult> => {
    // 1. Check if Web Share API is supported and can share files
    const canShare =
        navigator.share &&
        navigator.canShare &&
        navigator.canShare({ files: [file] });

    if (canShare && target === 'system') {
        try {
            await navigator.share({
                files: [file],
                title: 'Check out my NEON-RHYTHM run!',
                text: 'I just finished a run on NEON-RHYTHM. Look at these moves!',
            });
            return { success: true, method: 'native' };
        } catch (error) {
            console.error('Error sharing via Web Share API:', error);
            if ((error as Error).name === 'AbortError') {
                return { success: false, method: 'native', error: 'User cancelled' };
            }
            // Fall through to download if native share fails for other reasons
        }
    }

    // 2. Fallback: Trigger download
    saveVideo(file);
    return { success: true, method: 'fallback' };
};

/**
 * Triggers a download of the video file.
 */
export const saveVideo = (file: File): void => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/**
 * Returns the upload URL for a specific platform.
 */
export const getPlatformUploadUrl = (target: ShareTarget): string => {
    switch (target) {
        case 'tiktok':
            return 'https://www.tiktok.com/upload';
        case 'instagram':
            return 'https://www.instagram.com/reels/';
        case 'youtube':
            return 'https://www.youtube.com/upload?v=create'; // YouTube upload page
        default:
            return '';
    }
};

/**
 * Returns human-readable instructions for platform sharing.
 */
export const getPlatformInstructions = (target: ShareTarget): string[] => {
    switch (target) {
        case 'tiktok':
            return [
                'Video saved. Upload it to TikTok.',
                'Open TikTok and tap the + button.',
                'Select the video from your gallery.',
                'Add #NeonRhythm and post!'
            ];
        case 'instagram':
            return [
                'Video saved. Upload it to Instagram.',
                'Open Instagram Reels to upload.',
                'If sharing from PC, use a mobile browser or app for best results.',
                'Share it with your followers!'
            ];
        case 'youtube':
            return [
                'Video saved. Upload it to YouTube.',
                'Open YouTube and tap Create.',
                'Select your video from the gallery.',
                'Publish your masterpiece!'
            ];
        default:
            return ['Video downloaded. You can now share it manually.'];
    }
};
