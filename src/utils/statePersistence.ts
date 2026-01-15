/**
 * State Persistence Module
 * Persists in-memory state to MongoDB for survival across restarts
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import Logger from '../utils/logger';

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

export interface IBotState extends Document {
    key: string;
    value: any;
    updatedAt: Date;
}

const botStateSchema = new Schema<IBotState>({
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now },
});

let BotState: Model<IBotState>;

const getBotStateModel = (): Model<IBotState> => {
    if (!BotState) {
        BotState = mongoose.models.BotState || mongoose.model<IBotState>('BotState', botStateSchema);
    }
    return BotState;
};

// ============================================================================
// STATE KEYS
// ============================================================================

export const STATE_KEYS = {
    COPIED_MARKETS: 'copied_markets_per_wallet',
    POSITION_PEAKS: 'position_peaks',
} as const;

// ============================================================================
// PERSISTENCE FUNCTIONS
// ============================================================================

/**
 * Save state to MongoDB
 */
export const saveState = async (key: string, value: any): Promise<void> => {
    try {
        const model = getBotStateModel();
        await model.findOneAndUpdate(
            { key },
            { value, updatedAt: new Date() },
            { upsert: true }
        );
    } catch (error) {
        Logger.warning(`Failed to save state ${key}: ${error}`);
    }
};

/**
 * Load state from MongoDB
 */
export const loadState = async <T>(key: string, defaultValue: T): Promise<T> => {
    try {
        const model = getBotStateModel();
        const doc = await model.findOne({ key });
        if (doc && doc.value !== undefined) {
            return doc.value as T;
        }
    } catch (error) {
        Logger.warning(`Failed to load state ${key}: ${error}`);
    }
    return defaultValue;
};

/**
 * Clear state from MongoDB
 */
export const clearState = async (key: string): Promise<void> => {
    try {
        const model = getBotStateModel();
        await model.deleteOne({ key });
    } catch (error) {
        Logger.warning(`Failed to clear state ${key}: ${error}`);
    }
};

// ============================================================================
// SERIALIZATION HELPERS (for Maps and Sets)
// ============================================================================

/**
 * Serialize a Map<string, Set<string>> to JSON-compatible format
 */
export const serializeMapOfSets = (map: Map<string, Set<string>>): Record<string, string[]> => {
    const obj: Record<string, string[]> = {};
    for (const [key, set] of map) {
        obj[key] = Array.from(set);
    }
    return obj;
};

/**
 * Deserialize JSON to Map<string, Set<string>>
 */
export const deserializeMapOfSets = (obj: Record<string, string[]> | null): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    if (obj) {
        for (const [key, arr] of Object.entries(obj)) {
            map.set(key, new Set(arr));
        }
    }
    return map;
};

/**
 * Serialize a Map to JSON-compatible format
 */
export const serializeMap = <T>(map: Map<string, T>): Record<string, T> => {
    const obj: Record<string, T> = {};
    for (const [key, value] of map) {
        obj[key] = value;
    }
    return obj;
};

/**
 * Deserialize JSON to Map
 */
export const deserializeMap = <T>(obj: Record<string, T> | null): Map<string, T> => {
    const map = new Map<string, T>();
    if (obj) {
        for (const [key, value] of Object.entries(obj)) {
            map.set(key, value);
        }
    }
    return map;
};
