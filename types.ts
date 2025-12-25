/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import React from "react";

export enum GameStatus {
  LOADING = "LOADING",
  MENU = "MENU",
  PLAYING = "PLAYING",
  ANALYZING = "ANALYZING",
  RESULT = "RESULT",
  TRANSITION = "TRANSITION",
}

export type RobotState = "happy" | "sad" | "analyzing" | "average";

export type Difficulty = "EASY" | "MEDIUM" | "HARD" | "NIGHTMARE";

export interface LevelConfig {
  name: string;
  bpm: number;
  length: number;
  color: string;
}

export const DIFFICULTIES: Record<Difficulty, LevelConfig> = {
  EASY: { name: "VIBE CHECK", bpm: 95, length: 8, color: "text-green-500" },
  MEDIUM: {
    name: "IN THE GROOVE",
    bpm: 110,
    length: 8,
    color: "text-white",
  },
  HARD: { name: "HYPER FOCUS", bpm: 130, length: 11, color: "text-white" },
  NIGHTMARE: { name: "VIRTUOSO", bpm: 150, length: 14, color: "text-red-500" },
};

export interface GeminiResponse {
  success: boolean;
  correct_count: number;
  score: number;
  feedback: string;
  detailed_results: boolean[];
  detected_counts: number[];
}

export type HandType = "left" | "right";

export enum CutDirection {
  UP = "UP",
  DOWN = "DOWN",
  LEFT = "LEFT",
  RIGHT = "RIGHT",
  ANY = "ANY",
}

export interface NoteData {
  id: string;
  time: number;
  lineIndex: number;
  lineLayer: number;
  type: HandType;
  cutDirection: CutDirection;
  hit?: boolean;
  hitTime?: number;
  missed?: boolean;
}

export interface HandPositions {
  left: THREE.Vector3 | null;
  right: THREE.Vector3 | null;
  leftVelocity: THREE.Vector3 | null;
  rightVelocity: THREE.Vector3 | null;
}

export const COLORS = {
  left: "#ff0000",
  right: "#ffffff",
};

// Fix for R3F types
// Augment React's JSX namespace
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      spotLight: any;
      color: any;
      fog: any;
      mesh: any;
      group: any;
      position: any;
      planeGeometry: any;
      meshStandardMaterial: any;
      sphereGeometry: any;
      meshBasicMaterial: any;
      meshPhysicalMaterial: any;
      octahedronGeometry: any;
      extrudeGeometry: any;
      cylinderGeometry: any;
      torusGeometry: any;
      ringGeometry: any;
      capsuleGeometry: any;
      primitive: any;
      [elemName: string]: any;
    }
  }
}

// Augment Global JSX namespace
declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      spotLight: any;
      color: any;
      fog: any;
      mesh: any;
      group: any;
      position: any;
      planeGeometry: any;
      meshStandardMaterial: any;
      sphereGeometry: any;
      meshBasicMaterial: any;
      meshPhysicalMaterial: any;
      octahedronGeometry: any;
      extrudeGeometry: any;
      cylinderGeometry: any;
      torusGeometry: any;
      ringGeometry: any;
      capsuleGeometry: any;
      primitive: any;
      [elemName: string]: any;
    }
  }
}
