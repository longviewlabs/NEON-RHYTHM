/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import { RobotState } from '../types';

interface RobotProps {
    state: RobotState;
}

const Robot: React.FC<RobotProps> = ({ state }) => {
    return (
        <div className={`transform scale-75 md:scale-100 transition-all duration-500`}>
            {/* --- SAD ROBOT --- */}
            {state === 'sad' && (
                <div className="relative">
                    <div className="w-1.5 h-6 bg-gray-300 absolute -top-4 left-1/2 -translate-x-1/2 origin-bottom -rotate-45 z-0 animate-pulse">
                         <div className="w-3.5 h-3.5 bg-blue-500 rounded-full absolute -top-3.5 -left-1 shadow-[0_0_8px_#3b82f6] opacity-50"></div>
                    </div>
                    <div className="w-36 h-28 bg-white rounded-[45px] relative flex justify-center items-center shadow-lg z-10 animate-sob">
                        <div className="w-24 h-16 bg-gray-800 rounded-[28px] relative flex flex-col justify-center items-center overflow-hidden border-4 border-gray-400 shadow-inner">
                            <div className="flex gap-4 mb-2 z-10">
                                <div className="w-3.5 h-3.5 bg-green-400 rounded-full shadow-[0_0_5px_#4ade80] animate-squeeze"></div>
                                <div className="w-3.5 h-3.5 bg-green-400 rounded-full shadow-[0_0_5px_#4ade80] animate-squeeze"></div>
                            </div>
                            <div className="w-5 h-2.5 border-t-4 border-green-400 rounded-t-xl opacity-90"></div>
                            
                            {/* Tears */}
                            <div className="absolute w-2 h-2 bg-blue-400 rounded-full top-4 left-5 opacity-0 animate-cry" style={{animationDelay: '0s'}}></div>
                            <div className="absolute w-2 h-2 bg-blue-400 rounded-full top-4 right-5 opacity-0 animate-cry" style={{animationDelay: '0.4s'}}></div>
                        </div>
                    </div>
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-16 h-4 bg-blue-400/30 rounded-full animate-pulse"></div>
                </div>
            )}

            {/* --- HAPPY ROBOT --- */}
            {state === 'happy' && (
                <div className="relative">
                     {/* Particles */}
                    <div className="absolute -top-10 -left-10 text-yellow-400 text-2xl animate-ping">★</div>
                    <div className="absolute -top-8 -right-10 text-pink-500 text-xl animate-bounce">♥</div>

                    <div className="w-1.5 h-6 bg-gray-300 absolute -top-4 left-1/2 -translate-x-1/2 origin-bottom z-0 animate-[waggle_0.2s_linear_infinite]">
                         <div className="w-3.5 h-3.5 bg-yellow-400 rounded-full absolute -top-3.5 -left-1 shadow-[0_0_15px_#facc15] animate-pulse"></div>
                    </div>
                    <div className="w-36 h-28 bg-white rounded-[45px] relative flex justify-center items-center shadow-[0_10px_25px_rgba(255,215,64,0.4)] z-10 animate-jump">
                        <div className="w-24 h-16 bg-gray-800 rounded-[28px] relative flex flex-col justify-center items-center overflow-hidden border-4 border-yellow-400 shadow-[inset_0_0_15px_rgba(255,215,64,0.3)]">
                            <div className="flex gap-5 mb-0.5 z-10">
                                <div className="w-4 h-3 border-t-[5px] border-green-400 rounded-t-full shadow-[0_-2px_5px_rgba(0,230,118,0.5)] animate-twinkle"></div>
                                <div className="w-4 h-3 border-t-[5px] border-green-400 rounded-t-full shadow-[0_-2px_5px_rgba(0,230,118,0.5)] animate-twinkle"></div>
                            </div>
                            <div className="w-6 h-3.5 bg-green-400 rounded-b-xl mt-1 overflow-hidden relative animate-[big-grin_0.8s_infinite]">
                                <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-2.5 bg-pink-400 rounded-full"></div>
                            </div>
                            <div className="absolute bottom-3 left-3 w-3 h-2 bg-pink-400 rounded-full opacity-80 animate-pulse"></div>
                            <div className="absolute bottom-3 right-3 w-3 h-2 bg-pink-400 rounded-full opacity-80 animate-pulse"></div>
                        </div>
                    </div>
                </div>
            )}

            {/* --- ANALYZING ROBOT --- */}
            {state === 'analyzing' && (
                <div className="relative">
                    <div className="w-1.5 h-6 bg-gray-300 absolute -top-4 left-1/2 -translate-x-1/2 origin-bottom z-0 animate-[waggle_3s_ease_infinite]">
                         <div className="w-3.5 h-3.5 bg-red-500 rounded-full absolute -top-3.5 -left-1 shadow-[0_0_8px_#ef4444] animate-pulse"></div>
                    </div>
                    <div className="w-36 h-28 bg-white rounded-[45px] relative flex justify-center items-center shadow-lg z-10 animate-jump">
                        <div className="w-24 h-16 bg-gray-800 rounded-[28px] relative flex flex-col justify-center items-center overflow-hidden border-4 border-blue-200 shadow-inner">
                            <div className="absolute w-full h-1/3 bg-gradient-to-b from-transparent via-green-400/20 to-transparent top-[-50%] animate-scan z-20"></div>
                            <div className="flex gap-4 mb-1 animate-look z-10">
                                <div className="w-3.5 h-3.5 bg-green-400 rounded-full shadow-[0_0_12px_#4ade80]"></div>
                                <div className="w-3.5 h-3.5 bg-green-400 rounded-full shadow-[0_0_12px_#4ade80]"></div>
                            </div>
                            <div className="w-4 h-2 border-b-2 border-green-400 rounded-b-lg"></div>
                        </div>
                    </div>
                    <div className="absolute -right-4 -top-4 w-8 h-8 border-2 border-dashed border-orange-300 rounded-full animate-spin opacity-80"></div>
                </div>
            )}

            {/* --- AVERAGE ROBOT --- */}
            {state === 'average' && (
                <div className="relative">
                    <div className="w-1.5 h-6 bg-gray-300 absolute -top-4 left-1/2 -translate-x-1/2 origin-bottom z-0 animate-[slow-sway_4s_infinite]">
                         <div className="w-3.5 h-3.5 bg-purple-300 rounded-full absolute -top-3.5 -left-1 shadow-[0_0_8px_#d8b4fe] opacity-70"></div>
                    </div>
                    <div className="w-36 h-28 bg-white rounded-[45px] relative flex justify-center items-center shadow-lg z-10 animate-[polite-hover_4s_infinite]">
                        <div className="w-24 h-16 bg-gray-800 rounded-[28px] relative flex flex-col justify-center items-center overflow-hidden border-4 border-purple-300 shadow-inner">
                            <div className="flex gap-5 mb-1.5">
                                <div className="w-3.5 h-3.5 bg-purple-300 rounded-full shadow-[0_0_8px_#d8b4fe] animate-[slow-blink_4s_infinite]"></div>
                                <div className="w-3.5 h-3.5 bg-purple-300 rounded-full shadow-[0_0_8px_#d8b4fe] animate-[slow-blink_4s_infinite]"></div>
                            </div>
                            <div className="w-4 h-1.5 border-b-2 border-purple-300 rounded-full"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Robot;
