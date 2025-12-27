import React from 'react';

const SafeZone: React.FC = () => {
    return (
        <div className="absolute inset-0 pointer-events-none z-10 hidden md:flex justify-center items-center">
            {/* 9:16 Aspect Ratio Boundary */}
            <div
                className="h-full border-x border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.5)] bg-black/5"
                style={{ aspectRatio: '9 / 16' }}
            >
                {/* Optional: Subtle corner markers could go here if needed */}
            </div>

            {/* Darkened areas outside the safe zone */}
            <div className="absolute inset-y-0 left-0 right-0 flex justify-between pointer-events-none">
                <div className="h-full flex-1 bg-black/[0.12] backdrop-blur-[1px]" style={{ marginRight: '-1px' }} />
                <div style={{ aspectRatio: '9 / 16' }} className="h-full" />
                <div className="h-full flex-1 bg-black/[0.12] backdrop-blur-[1px]" style={{ marginLeft: '-1px' }} />
            </div>
        </div>
    );
};

export default SafeZone;
