import React from 'react';
import { X, Download, ExternalLink } from 'lucide-react';
import { ShareTarget, getPlatformInstructions, getPlatformUploadUrl } from '../utils/shareUtils';

interface ShareInstructionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    target: ShareTarget;
    onDownload: () => void;
    isDownloaded: boolean;
}

const ShareInstructionsModal: React.FC<ShareInstructionsModalProps> = ({
    isOpen,
    onClose,
    target,
    onDownload,
    isDownloaded,
}) => {
    if (!isOpen) return null;

    const instructions = getPlatformInstructions(target);
    const uploadUrl = getPlatformUploadUrl(target);
    const platformLabel = target.charAt(0).toUpperCase() + target.slice(1);

    const handleCopyLink = () => {
        navigator.clipboard.writeText(window.location.href);
        alert('Link copied to clipboard!');
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="relative w-full max-w-md bg-[#1a1a2e] border border-white/10 rounded-3xl p-8 shadow-2xl animate-pop max-h-[90vh] overflow-y-auto no-scrollbar">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"
                >
                    <X size={24} />
                </button>

                {target === 'system' ? (
                    <div className="flex flex-col gap-6">
                        <div className="text-center mb-2">
                            <h2 className="text-2xl font-black uppercase tracking-tight">
                                Share Options
                            </h2>
                            <p className="text-white/40 text-xs mt-1">Choose how you want to share your run</p>
                        </div>

                        <div className="flex flex-col gap-3">
                            <button
                                onClick={onDownload}
                                className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                            >
                                <Download size={20} />
                                {isDownloaded ? "Download Again" : "Download Video"}
                            </button>

                            <button
                                onClick={handleCopyLink}
                                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-white/10"
                            >
                                <ExternalLink size={20} />
                                Copy Link
                            </button>

                            <div className="h-px bg-white/10 my-2" />

                            <a
                                href={getPlatformUploadUrl('tiktok')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-white/10"
                            >
                                Open TikTok
                            </a>
                            <a
                                href={getPlatformUploadUrl('instagram')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-white/10"
                            >
                                Open Instagram
                            </a>
                            <a
                                href={getPlatformUploadUrl('youtube')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-white/10"
                            >
                                Open YouTube
                            </a>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="text-center mb-8">
                            <div className="w-20 h-20 bg-gradient-to-tr from-blue-600 to-pink-600 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg">
                                <span className="text-4xl">
                                    {target === 'tiktok' ? '🎵' : target === 'instagram' ? '📸' : target === 'youtube' ? '🎥' : '📱'}
                                </span>
                            </div>
                            <h2 className="text-2xl font-black uppercase tracking-tight">
                                Post to {platformLabel}
                            </h2>
                        </div>

                        <div className="space-y-6 mb-8">
                            {instructions.map((step, i) => (
                                <div key={i} className="flex gap-4 items-start">
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center font-bold text-sm border border-white/10">
                                        {i + 1}
                                    </div>
                                    <p className="text-white/80 text-sm leading-relaxed pt-1">
                                        {step}
                                    </p>
                                </div>
                            ))}
                        </div>

                        <div className="flex flex-col gap-3">
                            {!isDownloaded && (
                                <button
                                    onClick={onDownload}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                                >
                                    <Download size={20} />
                                    Download Video
                                </button>
                            )}

                            {uploadUrl && (
                                <a
                                    href={uploadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-white/10"
                                >
                                    <ExternalLink size={20} />
                                    Open {platformLabel}
                                </a>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ShareInstructionsModal;
