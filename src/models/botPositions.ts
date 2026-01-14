/**
 * Bot Position Tracking Model
 * Tracks the bot's owned positions for accurate sell calculations
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBotPosition extends Document {
    conditionId: string;
    asset: string;
    tokensHeld: number;
    totalInvested: number;
    avgEntryPrice: number;
    lastUpdated: Date;
}

const botPositionSchema = new Schema<IBotPosition>({
    conditionId: { type: String, required: true, unique: true, index: true },
    asset: { type: String, required: true },
    tokensHeld: { type: Number, default: 0 },
    totalInvested: { type: Number, default: 0 },
    avgEntryPrice: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
});

// Create index for faster lookups
botPositionSchema.index({ conditionId: 1 });

let BotPosition: Model<IBotPosition>;

/**
 * Get the BotPosition model (lazy initialization to avoid model conflicts)
 */
export const getBotPositionModel = (): Model<IBotPosition> => {
    if (!BotPosition) {
        BotPosition = mongoose.models.BotPosition || mongoose.model<IBotPosition>('BotPosition', botPositionSchema);
    }
    return BotPosition;
};

/**
 * Get a tracked position by conditionId
 */
export const getBotPosition = async (conditionId: string): Promise<IBotPosition | null> => {
    const model = getBotPositionModel();
    return model.findOne({ conditionId });
};

/**
 * Update position after a BUY order
 */
export const updateBotPosition = async (
    conditionId: string,
    asset: string,
    tokensBought: number,
    usdcSpent: number
): Promise<IBotPosition> => {
    const model = getBotPositionModel();

    const existing = await model.findOne({ conditionId });

    if (existing) {
        // Update existing position with weighted average price
        const newTotalTokens = existing.tokensHeld + tokensBought;
        const newTotalInvested = existing.totalInvested + usdcSpent;
        const newAvgPrice = newTotalInvested / newTotalTokens;

        existing.tokensHeld = newTotalTokens;
        existing.totalInvested = newTotalInvested;
        existing.avgEntryPrice = newAvgPrice;
        existing.lastUpdated = new Date();

        return existing.save();
    }

    // Create new position
    const avgPrice = usdcSpent / tokensBought;
    return model.create({
        conditionId,
        asset,
        tokensHeld: tokensBought,
        totalInvested: usdcSpent,
        avgEntryPrice: avgPrice,
        lastUpdated: new Date(),
    });
};

/**
 * Reduce position after a SELL order
 */
export const reduceBotPosition = async (
    conditionId: string,
    tokensSold: number,
    usdcReceived: number
): Promise<void> => {
    const model = getBotPositionModel();
    const existing = await model.findOne({ conditionId });

    if (!existing) {
        return; // No position to reduce
    }

    const newTokensHeld = Math.max(0, existing.tokensHeld - tokensSold);

    if (newTokensHeld <= 0.0001) {
        // Position fully closed - delete record
        await model.deleteOne({ conditionId });
    } else {
        // Partial sell - reduce proportionally
        const sellRatio = tokensSold / existing.tokensHeld;
        existing.tokensHeld = newTokensHeld;
        existing.totalInvested = existing.totalInvested * (1 - sellRatio);
        existing.lastUpdated = new Date();
        await existing.save();
    }
};

/**
 * Get all tracked positions
 */
export const getAllBotPositions = async (): Promise<IBotPosition[]> => {
    const model = getBotPositionModel();
    return model.find({ tokensHeld: { $gt: 0.0001 } });
};

/**
 * Clear position by conditionId (used when position is fully closed)
 */
export const clearBotPosition = async (conditionId: string): Promise<void> => {
    const model = getBotPositionModel();
    await model.deleteOne({ conditionId });
};
