/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { RobotState } from "../types";

interface RobotProps {
  state: RobotState;
}

const Robot: React.FC<RobotProps> = ({ state }) => {
  const getGifPath = () => {
    switch (state) {
      case "happy":
        return "/win.gif";
      case "sad":
        return "/lose.gif";
      case "analyzing":
      case "average":
      default:
        return "/judging.gif";
    }
  };

  return (
    <div className="relative group">
      {/* Decorative Glow */}
      <div className="absolute -inset-4 bg-white/5 rounded-full blur-2xl opacity-50 group-hover:opacity-100 transition-opacity"></div>

      <div className="relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center">
        <img
          src={getGifPath()}
          alt={`${state} state`}
          className="w-full h-full object-contain rounded-3xl"
        />
      </div>
    </div>
  );
};

export default React.memo(Robot);
