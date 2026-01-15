/**
 * Weather Market MongoDB Model
 * Stores parsed weather markets for tracking and trading
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { WeatherMarket, WeatherBin, WeatherMarketStatus, WeatherMetric, WeatherUnit } from '../interfaces/WeatherMarket';

export interface IWeatherMarket extends Document, Omit<WeatherMarket, 'bins'> {
    bins: WeatherBin[];
}

const weatherBinSchema = new Schema<WeatherBin>({
    outcomeId: { type: String, required: true },
    tokenId: { type: String, required: true },
    label: { type: String, required: true },
    lowerBound: { type: Number, default: null },
    upperBound: { type: Number, default: null },
    isFloor: { type: Boolean, default: false },
    isCeiling: { type: Boolean, default: false },
}, { _id: false });

const weatherMarketSchema = new Schema<IWeatherMarket>({
    conditionId: { type: String, required: true, unique: true, index: true },
    marketSlug: { type: String, required: true },
    title: { type: String, required: true },
    stationId: { type: String, required: true, index: true },
    stationName: { type: String, required: true },
    region: { type: String, required: true, index: true },
    targetDate: { type: String, required: true, index: true },
    timezone: { type: String, required: true },
    metric: { type: String, enum: ['DAILY_MAX_TEMP', 'DAILY_MIN_TEMP', 'RAINFALL', 'SNOWFALL'], required: true },
    unit: { type: String, enum: ['F', 'C', 'inches', 'cm'], required: true },
    precision: { type: Number, default: 1 },
    resolutionSourceUrl: { type: String, required: true },
    bins: [weatherBinSchema],
    parsedAt: { type: Date, default: Date.now },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    status: { type: String, enum: ['ACTIVE', 'RESOLVED', 'SKIPPED', 'EXPIRED'], default: 'ACTIVE', index: true },
    resolvesAt: { type: Date, required: true, index: true },
});

// Compound indexes for efficient queries
weatherMarketSchema.index({ status: 1, resolvesAt: 1 });
weatherMarketSchema.index({ region: 1, targetDate: 1 });

let WeatherMarketModel: Model<IWeatherMarket>;

/**
 * Get the WeatherMarket model (lazy initialization)
 */
export const getWeatherMarketModel = (): Model<IWeatherMarket> => {
    if (!WeatherMarketModel) {
        WeatherMarketModel = mongoose.models.WeatherMarket ||
            mongoose.model<IWeatherMarket>('WeatherMarket', weatherMarketSchema);
    }
    return WeatherMarketModel;
};

/**
 * Find or create a weather market
 */
export const upsertWeatherMarket = async (market: WeatherMarket): Promise<IWeatherMarket> => {
    const model = getWeatherMarketModel();
    const result = await model.findOneAndUpdate(
        { conditionId: market.conditionId },
        { ...market, parsedAt: new Date() },
        { upsert: true, new: true }
    );
    return result;
};

/**
 * Get all active weather markets (not resolved/expired)
 */
export const getActiveWeatherMarkets = async (): Promise<IWeatherMarket[]> => {
    const model = getWeatherMarketModel();
    return model.find({
        status: 'ACTIVE',
        resolvesAt: { $gte: new Date() }
    }).sort({ resolvesAt: 1 });
};

/**
 * Get markets resolving within N days
 */
export const getMarketsWithinDays = async (days: number): Promise<IWeatherMarket[]> => {
    const model = getWeatherMarketModel();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    return model.find({
        status: 'ACTIVE',
        resolvesAt: { $gte: new Date(), $lte: cutoff }
    }).sort({ resolvesAt: 1 });
};

/**
 * Get markets by region
 */
export const getMarketsByRegion = async (region: string): Promise<IWeatherMarket[]> => {
    const model = getWeatherMarketModel();
    return model.find({ region, status: 'ACTIVE' });
};

/**
 * Update market status
 */
export const updateMarketStatus = async (
    conditionId: string,
    status: WeatherMarketStatus
): Promise<void> => {
    const model = getWeatherMarketModel();
    await model.updateOne({ conditionId }, { status });
};

/**
 * Mark expired markets
 */
export const markExpiredMarkets = async (): Promise<number> => {
    const model = getWeatherMarketModel();
    const result = await model.updateMany(
        { status: 'ACTIVE', resolvesAt: { $lt: new Date() } },
        { status: 'EXPIRED' }
    );
    return result.modifiedCount;
};
