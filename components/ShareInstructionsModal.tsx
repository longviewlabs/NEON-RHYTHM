import React from 'react';
import { X, Download, ExternalLink } from 'lucide-react';
import { ShareTarget, getPlatformInstructions, getPlatformUploadUrl } from '../utils/shareUtils';

interface ShareInstructionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    target: ShareTarget;
    onDownload: () => void;
    isDownloaded: boolean;
    showSaveToast?: boolean;
    roundNumber?: number;
}

const ShareInstructionsModal: React.FC<ShareInstructionsModalProps> = ({
    isOpen,
    onClose,
    target,
    onDownload,
    isDownloaded,
    showSaveToast = false,
    roundNumber = 1,
}) => {
    if (!isOpen) return null;

    const instructions = getPlatformInstructions(target);
    const uploadUrl = getPlatformUploadUrl(target);
    const platformLabel = target.charAt(0).toUpperCase() + target.slice(1);

    const handleCopyCaption = () => {
        const caption = `I made it to Round ${roundNumber} on Finger Rhythm. Can you beat me? fingerrhythm.com`;
        navigator.clipboard.writeText(caption);
        alert('Caption copied to clipboard!');
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
                                SHARE THIS VIDEO
                            </h2>
                            <p className="text-white/80 text-sm font-medium mt-4 leading-relaxed">
                                A video of you playing has been recorded.<br />Download the clip, then upload it wherever you want 🙌
                            </p>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div className="relative w-full">
                                <button
                                    onClick={onDownload}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                                >
                                    <Download size={20} />
                                    Save video
                                </button>
                                {showSaveToast && (
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[150] px-4 py-2 bg-green-600 text-white text-[10px] font-bold rounded-full shadow-2xl animate-fade-in border border-white/20 backdrop-blur-md whitespace-nowrap">
                                        Video downloaded
                                    </div>
                                )}
                            </div>
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
                            <div className="relative w-full">
                                <button
                                    onClick={onDownload}
                                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
                                >
                                    <Download size={20} />
                                    Save video
                                </button>
                                {showSaveToast && (
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[150] px-4 py-2 bg-green-600 text-white text-[10px] font-bold rounded-full shadow-2xl animate-fade-in border border-white/20 backdrop-blur-md whitespace-nowrap">
                                        Video downloaded
                                    </div>
                                )}
                            </div>

                            {uploadUrl && (
                                <a
                                    href={uploadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-black uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-white/10"
                                >
                                    <ExternalLink size={20} />
                                    {platformLabel}
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
